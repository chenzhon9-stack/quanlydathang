import { postGasWebhook, rememberGasIdempotency } from "@/lib/gas-webhook";
import {
  todayYmdVN,
  currentYearVN,
  formatDateTimeVN,
  ymdDate,
} from "@/lib/sheets/date";
import type { AccessScope, Order, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds, applyListScopeFilter } from "@/lib/scope";
import { OrderRepository } from "@/repositories/order.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { writeAudit } from "@/lib/sheets/audit";
import { generateMaDon, resolveMaDonClock } from "@/lib/sheets/ma-don";
import { appendSheetRow, readSheetAsObjects } from "@/lib/sheets/dal";
import { STATUS_DON, STATUS_CT } from "@/lib/status";
import { canResetOrder, isDuyenHaNcc, businessDayDiff } from "@/lib/order-reset";
import { syncOrderStatusByOrderId } from "@/lib/sync-order-status";

export interface OrderListFilter {
  year?: number;
  fromDate?: string;
  toDate?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderListResult {
  items: Order[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * OrderService — STEP 5 + AccessScope MANAGEMENT (V21 Quanly `;`)
 */
export class OrderService {
  static async listOrders(
    filter: OrderListFilter,
    user: UserContext,
    scope: AccessScope
  ): Promise<OrderListResult> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    let orders = await OrderRepository.findMany({
      year: filter.year,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      status: filter.status,
      supplierId: filter.supplierId,
    });

    // V21.07 multi-role: OWNER ∪ MANAGEMENT ∪ OWN_CUSTOMER
    orders = await applyListScopeFilter(orders, scope, filter.year);

    const nccMap = await MasterRepository.nccNames();
    const nccSend = await MasterRepository.nccSendMethods();
    orders = orders.map((o) => ({
      ...o,
      supplierName: o.supplierName || nccMap[o.supplierId] || o.supplierId,
      sendMethod:
        o.sendMethod ||
        nccSend[o.supplierId] ||
        nccSend[String(o.supplierId || "").toUpperCase()] ||
        "",
    }));

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = orders.length;
    const start = (page - 1) * pageSize;
    let items = orders.slice(start, start + pageSize);

    // V21: canReset / canCancelOrder — load CT năm 1 lần
    // hasUnreceived: còn xe chưa nhận (reset)
    // hasReceived: ≥1 CT đã nhận/giao → không hủy đơn (D112)
    const hasUnreceived = new Map<string, boolean>();
    const hasReceived = new Map<string, boolean>();
    try {
      const { DetailRepository } = await import(
        "@/repositories/detail.repository"
      );
      const allCt = await DetailRepository.findMany({ year: filter.year });
      for (const d of allCt) {
        const stRaw = String(d.status || "").trim();
        const st = stRaw.toUpperCase();
        if (st === "DELETE" || stRaw === STATUS_CT.DELETE) continue;
        const oid = String(d.orderId || "");
        if (!oid) continue;

        const receivedQty = Number(d.actualReceived) || 0;
        const isRecvStatus =
          receivedQty > 0 ||
          stRaw === STATUS_CT.RECEIVED ||
          stRaw === STATUS_CT.DELIVERING ||
          stRaw === STATUS_CT.DONE ||
          st.includes("NHẬN") ||
          st.includes("NHAN") ||
          st.includes("GIAO") ||
          st.includes("HOÀN") ||
          st.includes("HOAN");

        if (isRecvStatus) {
          hasReceived.set(oid, true);
        } else if (!hasReceived.has(oid)) {
          hasReceived.set(oid, false);
        }

        const unrecv =
          receivedQty === 0 &&
          st !== "CANCEL" &&
          stRaw !== STATUS_CT.CANCEL;
        if (unrecv) {
          hasUnreceived.set(oid, true);
        } else if (!hasUnreceived.has(oid)) {
          hasUnreceived.set(oid, false);
        }
      }
    } catch (e) {
      console.error("[listOrders] canReset/canCancel CT load", e);
    }

    items = items.map((o) => {
      const reset = canResetOrder({
        status: o.status,
        orderDate: o.orderDate,
        orderDateTime: o.orderDateTime,
        supplierId: o.supplierId,
        sendCount: o.sendCount,
        hasUnreceivedVehicle: hasUnreceived.get(o.orderId) === true,
      });
      // V21: đã có ≥1 xe nhận/giao → không hiện Hủy/Xóa
      const canCancelOrder = hasReceived.get(o.orderId) !== true;
      return { ...o, canReset: reset.ok, canCancelOrder };
    });

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }

  static async getOrder(
    maDon: string,
    user: UserContext,
    scope: AccessScope,
    year?: number
  ): Promise<Order> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    const order = await OrderRepository.findById(maDon, year);
    if (!order) {
      throw { code: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" };
    }

    // V21.07 multi-role: pass nếu BẤT KỲ nhánh scope match (union)
    if (scope.scopeType !== "ALL") {
      const allowOwner =
        scope.scopeType === "OWNER" ||
        scope.scopeType === "UNION" ||
        !!scope.allowOwner;
      const allowMgmt =
        scope.scopeType === "MANAGEMENT" ||
        scope.scopeType === "UNION" ||
        !!scope.allowManagement;
      let ok = false;
      if (
        allowOwner &&
        scope.ownerEmail &&
        (order.createdBy || "").toLowerCase() ===
          scope.ownerEmail.toLowerCase()
      ) {
        ok = true;
      }
      if (!ok && allowMgmt) {
        const allowed = await resolveAllowedSupplierIds({
          ...scope,
          scopeType: "MANAGEMENT",
        });
        // null = quanly all → mọi NCC
        if (allowed === null) {
          ok = true;
        } else if (
          order.supplierId &&
          (allowed.has(order.supplierId) ||
            allowed.has(String(order.supplierId).toUpperCase()))
        ) {
          ok = true;
        }
      }
      if (!ok) {
        throw {
          code: "SCOPE_DENIED",
          message: "Không thuộc phạm vi dữ liệu của bạn",
        };
      }
    }

    const nccMap = await MasterRepository.nccNames();
    const nccSend = await MasterRepository.nccSendMethods();
    return {
      ...order,
      supplierName:
        order.supplierName || nccMap[order.supplierId] || order.supplierId,
      sendMethod:
        order.sendMethod ||
        nccSend[order.supplierId] ||
        nccSend[String(order.supplierId || "").toUpperCase()] ||
        "",
    };
  }


  /**
   * Hủy đơn — V21 cancelOrder
   * Chặn nếu bất kỳ CT còn active có ThucNhan>0 hoặc TT ∈ RECEIVED/DELIVERING/DONE
   * Cascade: CT active → Hủy xe; soft-delete GH chưa giao
   */
  static async cancelOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_CANCEL") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền hủy đơn" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const y = year ?? currentYearVN();

    const { DetailRepository } = await import("@/repositories/detail.repository");
    const { DeliveryRepository } = await import(
      "@/repositories/delivery.repository"
    );

    const details = await DetailRepository.findMany({
      year: y,
      orderId,
    });
    if (!details.length) {
      // vẫn cho hủy header nếu không có CT
    }

    const blocked = details.filter((d) => {
      const st = String(d.status || "").trim();
      const received = Number(d.actualReceived) || 0;
      if (received > 0) return true;
      if (
        [
          STATUS_CT.RECEIVED,
          STATUS_CT.DELIVERING,
          STATUS_CT.DONE,
          "Đã nhận",
          "Đang giao",
          "Hoàn thành",
        ].includes(st)
      )
        return true;
      return false;
    });
    if (blocked.length) {
      throw {
        code: "VALIDATION_ERROR",
        message:
          `Không hủy được đơn ${orderId}: còn ${blocked.length} xe đã nhận/giao ` +
          `(${blocked
            .slice(0, 3)
            .map((d) => d.detailId)
            .join(", ")}).`,
      };
    }

    // Soft-delete GH chưa có thực giao + hủy CT
    let cancelledCt = 0;
    let deletedGh = 0;
    const now = formatDateTimeVN();
    for (const d of details) {
      const st = String(d.status || "").trim();
      if (st === STATUS_CT.CANCEL || st === STATUS_CT.DELETE) continue;

      const ghs = await DeliveryRepository.findMany({
        year: y,
        detailId: d.detailId,
        includeDeleted: false,
      });
      for (const g of ghs) {
        if ((Number(g.actualQty) || 0) > 0) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Xe ${d.detailId} đã có thực giao, không hủy đơn.`,
          };
        }
        const r = await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          g.deliveryId,
          { Deleted: true, DeletedAt: now, DeletedBy: user.email },
          y
        );
        if (r > 0) deletedGh++;
      }

      const r = await updateSheetRowByKey(
        SHEETS.CT,
        "ID_Chitiet",
        d.detailId,
        {
          TrangThaiXe: STATUS_CT.CANCEL,
          ThucNhan: 0,
          TimeChange: now,
          User: user.email,
        },
        y
      );
      if (r > 0) cancelledCt++;
    }

    const row = await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      { TrangThaiDon: STATUS_DON.CANCEL },
      y
    );
    if (row < 0)
      throw { code: "NOT_FOUND", message: "Không tìm thấy đơn " + orderId };

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "CANCEL_ORDER",
      maDon: orderId,
      targetId: orderId,
      newValue: { cancelledCt, deletedGh },
      lyDo: `Hủy đơn: ${cancelledCt} CT, soft-delete ${deletedGh} GH`,
      year: y,
    });

    return {
      orderId,
      status: "CANCEL",
      row,
      cancelledCt,
      deletedGh,
    };
  }

  /** Đồng bộ trạng thái đơn theo CT (public helper) */
  static async syncStatus(orderId: string, year?: number) {
    return syncOrderStatusByOrderId(orderId, year);
  }


  /**
   * Tạo đơn mới — parity V21 saveFullNewOrder
   * - ≤ 6 xe
   * - generateUniqueMaDon + CT/GH counter
   * - mỗi CT ≥ 1 dòng GH, chia hết TyleChiahet
   */
  static async createOrder(
    payload: {
      supplierId: string;
      orderDate?: string;
      year?: number;
      details: Array<{
        vehicleId: string;
        productId: string;
        regionId: string;
        note?: string;
        transportTypeId?: string;
        transportTypeName?: string;
        carrierId?: string;
        deliveries: Array<{
          customerId: string;
          customerDetail?: string;
          plannedQty: number;
        }>;
      }>;
    },
    user: UserContext
  ) {
    if (
      !hasPermission(user, "ORDER_CREATE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền tạo đơn" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }

    const maNcc = String(payload.supplierId || "").trim();
    if (!maNcc) {
      throw { code: "VALIDATION_ERROR", message: "Thiếu nhà cung cấp." };
    }
    const details = payload.details || [];
    if (!details.length) {
      throw { code: "VALIDATION_ERROR", message: "Chưa có chi tiết đơn hàng." };
    }
    if (details.length > 6) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Mỗi đơn hàng không được vượt quá 6 xe.",
      };
    }

    // Trùng xe + hàng trong payload (tạo đơn mới — chưa có CT cũ)
    const pairKey = (v: string, p: string) =>
      `${String(v || "").trim().toUpperCase()}|${String(p || "").trim().toUpperCase()}`;
    const seen = new Set<string>();
    for (const d of details) {
      const key = pairKey(d.vehicleId, d.productId);
      if (seen.has(key)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Xe "${d.vehicleId}" và hàng "${d.productId}" xuất hiện 2 lần`,
        };
      }
      seen.add(key);
    }

    const { ymdDate } = await import("@/lib/sheets/date");
    const { generateUniqueMaDon } = await import("@/lib/sheets/ma-don");
    const { nextCounterCodes } = await import("@/lib/sheets/counter");
    const { appendSheetRow, readSheetAsObjects } = await import(
      "@/lib/sheets/dal"
    );
    const { qty3, validateStep } = await import("@/lib/business-rules");

    // API/logic: yyyy-MM-dd hoặc datetime local; DAL ghi Sheet → serial Date (V21)
    const ngayDatRaw = String(payload.orderDate || "").trim();
    let ngayDat = "";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ngayDatRaw)) {
      ngayDat = ngayDatRaw.length === 16 ? ngayDatRaw + ":00" : ngayDatRaw.slice(0, 19);
    } else {
      ngayDat = ymdDate(ngayDatRaw) || ymdDate(new Date()) || "";
    }
    const y =
      payload.year ??
      Number(String(ngayDat).slice(0, 4)) ??
      currentYearVN();

    // HH map cho chia hết
    const hhRows = await readSheetAsObjects(SHEETS.HH, { year: y }).catch(
      () => [] as Record<string, string>[]
    );
    const hhById = new Map<string, Record<string, string>>();
    for (const r of hhRows) {
      const id = String(r.MaHH || r.MaHh || "").trim();
      if (id) hhById.set(id, r);
    }

    // Validate từng CT
    for (const d of details) {
      if (!String(d.productId || "").trim()) {
        throw { code: "VALIDATION_ERROR", message: "Thiếu hàng hóa." };
      }
      if (!String(d.regionId || "").trim()) {
        throw { code: "VALIDATION_ERROR", message: "Thiếu Khu vực/Công trình." };
      }
      if (!String(d.vehicleId || "").trim()) {
        throw { code: "VALIDATION_ERROR", message: "Thiếu mã xe." };
      }
      if (!d.deliveries?.length) {
        throw {
          code: "VALIDATION_ERROR",
          message: "Mỗi xe phải có ít nhất 1 dòng kế hoạch giao.",
        };
      }
      const product = hhById.get(String(d.productId).trim());
      const tlCH = Number(
        product?.TyleChiahet || product?.TyleChiaHet || 0
      ) || 0;
      const tenHH =
        product?.TenHangHoa || product?.TenHH || d.productId;
      for (const dl of d.deliveries) {
        if (!String(dl.customerId || "").trim()) {
          throw {
            code: "VALIDATION_ERROR",
            message: "Dòng kế hoạch giao thiếu khách hàng.",
          };
        }
        const khg = qty3(Number(dl.plannedQty) || 0);
        if (!(khg > 0)) {
          throw {
            code: "VALIDATION_ERROR",
            message: "Sản lượng kế hoạch giao phải lớn hơn 0.",
          };
        }
        if (!validateStep(khg, tlCH)) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Kế hoạch giao cho ${tenHH} phải chia hết cho ${tlCH} tấn. Giá trị hiện tại: ${khg} tấn.`,
          };
        }
      }
    }

    const { maDon } = await generateUniqueMaDon(maNcc, ngayDat, { year: y });
    const isDuyenHa =
      ["dha", "btay"].includes(maNcc.toLowerCase());

    const detailIds = await nextCounterCodes("CT", ngayDat, {
      count: details.length,
      email: user.email,
      year: y,
    });
    const totalGh = details.reduce(
      (s, d) => s + (d.deliveries?.length || 0),
      0
    );
    const deliveryIds = await nextCounterCodes("GH", ngayDat, {
      count: totalGh,
      email: user.email,
      year: y,
    });

    const now = formatDateTimeVN();
    let ghIndex = 0;

    // DonHang
    await appendSheetRow(
      SHEETS.DH,
      {
        MaDon: maDon,
        NgayDatHang: ngayDat,
        MaNCC: maNcc,
        LanGui: 0,
        TrangThaiDon: STATUS_DON.NEW,
        TongSoChitiet: details.length,
        ChitietHuy: 0,
        FileDonhang: "",
        ChoGuiMail: false,
        timeGuimail: "",
        GuiLaimail: false,
        User: user.email,
      },
      y
    );

    for (let idx = 0; idx < details.length; idx++) {
      const d = details[idx];
      const idCt = detailIds[idx];
      const khTotal = qty3(
        (d.deliveries || []).reduce(
          (s, x) => s + (Number(x.plannedQty) || 0),
          0
        )
      );

      await appendSheetRow(
        SHEETS.CT,
        {
          ID_Chitiet: idCt,
          NgayDatHang: ngayDat,
          MaDon: maDon,
          MaNCC: maNcc,
          MaXe: d.vehicleId,
          MaHH: d.productId,
          SoLuong: khTotal,
          Khuvuc: d.regionId,
          KhoXuat: "",
          GhiChu: d.note || "",
          TrangThaiXe: STATUS_CT.NEW,
          TimeChange: now,
          NgayNhanHang: "",
          ThucNhan: 0,
          User: user.email,
          MaHTVT: d.transportTypeId || "",
          TenHTVT: d.transportTypeName || "",
          IsDuyenHa: isDuyenHa ? "TRUE" : "FALSE",
        },
        y
      );

      // DonHang_VanTai nếu thuê ngoài
      if (
        d.transportTypeId &&
        String(d.transportTypeId).toUpperCase().includes("THUE") &&
        d.carrierId
      ) {
        await appendSheetRow(
          SHEETS.CT_VT,
          {
            ID_Chitiet: idCt,
            MaXe: d.vehicleId,
            MaDVT: d.carrierId,
            UpdatedAt: now,
            UpdatedBy: user.email,
          },
          y
        ).catch(() => undefined);
      }

      for (const dl of d.deliveries || []) {
        const idGh = deliveryIds[ghIndex++];
        await appendSheetRow(
          SHEETS.GH,
          {
            ID_Giaohang: idGh,
            ID_Chitiet: idCt,
            MaKh: dl.customerId,
            ChitietKh: dl.customerDetail || "",
            KHgiao: qty3(Number(dl.plannedQty) || 0),
            ThucGiao: 0,
            Ngaygiao: "",
            Ghichu: "",
            Deleted: false,
            DeletedAt: "",
            DeletedBy: "",
          },
          y
        );
      }
    }

    try {
      const { writeAudit } = await import("@/lib/sheets/audit");
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "CREATE_ORDER",
        maDon,
        targetId: maDon,
        newValue: JSON.stringify({
          detailCount: details.length,
          deliveryCount: totalGh,
          detailIds,
        }),
        year: y,
      });
    } catch {
      /* audit optional */
    }

    return {
      orderId: maDon,
      orderDate: ngayDat,
      supplierId: maNcc,
      detailCount: details.length,
      deliveryCount: totalGh,
      detailIds,
      status: "NEW",
    };
  }


  /**
   * Thêm xe vào đơn có sẵn — parity V21 saveOrderBatch type ADD_DETAIL
   * - Đơn editable (NEW / chưa gửi cứng)
   * - Tổng xe active ≤ 6
   * - Validate + counter CT/GH giống createOrder
   */
  static async addDetailsToOrder(
    orderId: string,
    payload: {
      year?: number;
      details: Array<{
        vehicleId: string;
        productId: string;
        regionId: string;
        note?: string;
        transportTypeId?: string;
        transportTypeName?: string;
        carrierId?: string;
        deliveries: Array<{
          customerId: string;
          customerDetail?: string;
          plannedQty: number;
        }>;
      }>;
    },
    user: UserContext
  ) {
    if (
      !hasPermission(user, "ORDER_CREATE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền thêm xe" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }

    const details = payload.details || [];
    if (!details.length) {
      throw { code: "VALIDATION_ERROR", message: "Chưa có chi tiết xe cần thêm." };
    }

    const y = payload.year ?? currentYearVN();
    const order = await OrderRepository.findById(orderId, y);
    if (!order) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy đơn " + orderId };
    }

    const st = String(order.status || "");
    const stU = st.toUpperCase();
    // Cho phép thêm khi Khởi tạo / Đang xử lý; cấm Hủy / Hoàn thành
    if (
      stU.includes("CANCEL") ||
      st.includes("Hủy") ||
      stU === "DONE" ||
      st.includes("Hoàn thành")
    ) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Đơn đã hủy hoặc hoàn thành, không thêm xe.",
      };
    }
    // Nếu đã gửi mail nhiều lần — vẫn cho purchase/admin thêm? V21: !_isOrderEditable_ chặn batch.
    // Editable khi NEW hoặc chưa có file/lanGui lớn — nới: cho NEW + PROCESSING
    const editable =
      stU === "NEW" ||
      st.includes("Khởi tạo") ||
      stU === "PROCESSING" ||
      st.includes("Đang xử lý");
    if (!editable) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Trạng thái đơn không cho phép thêm xe.",
      };
    }

    const { DetailRepository } = await import("@/repositories/detail.repository");
    const existing = await DetailRepository.findMany({ year: y, orderId });
    const active = existing.filter((d) => {
      const s = String(d.status || "");
      return !s.includes("Xóa") && s !== STATUS_CT.DELETE;
    });
    if (active.length + details.length > 6) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Mỗi đơn tối đa 6 xe (hiện ${active.length}, thêm ${details.length}).`,
      };
    }

    // Trùng xe+hàng với active hiện có
    // Trùng xe + hàng với CT active + trong payload (V21, không phân biệt hoa thường)
    const pairKey = (v: string, p: string) =>
      `${String(v || "").trim().toUpperCase()}|${String(p || "").trim().toUpperCase()}`;
    const seen = new Set(
      active.map((d) => pairKey(d.vehicleId || "", d.productId || "")).filter((k) => k !== "|")
    );
    for (const d of details) {
      const key = pairKey(d.vehicleId, d.productId);
      if (seen.has(key)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Xe "${d.vehicleId}" và hàng "${d.productId}" xuất hiện 2 lần`,
        };
      }
      seen.add(key);
    }

    const { ymdDate, formatDateTimeVN, parseLocalDate } = await import(
      "@/lib/sheets/date"
    );
    const { nextCounterCodes } = await import("@/lib/sheets/counter");
    const { appendSheetRow, readSheetAsObjects } = await import(
      "@/lib/sheets/dal"
    );
    const { qty3, validateStep } = await import("@/lib/business-rules");
    const { writeAudit } = await import("@/lib/sheets/audit");

    // NgayDatHang CT = full datetime của đơn (user chọn), KHÔNG ép 00:00:00
    let ngayDatHangCt: string | number = "";
    try {
      const dhRows = await readSheetAsObjects(SHEETS.DH, { year: y });
      const dhRaw = dhRows.find(
        (r) =>
          String(r.MaDon || "")
            .trim()
            .toUpperCase() === String(orderId).trim().toUpperCase()
      );
      if (dhRaw && dhRaw.NgayDatHang != null && String(dhRaw.NgayDatHang).trim() !== "") {
        ngayDatHangCt = dhRaw.NgayDatHang as string | number;
      }
    } catch {
      /* fallback */
    }
    if (ngayDatHangCt === "" || ngayDatHangCt == null) {
      // order.orderDate có thể chỉ yyyy-MM-dd — giữ nguyên chuỗi nếu có giờ
      const rawOd = String(order.orderDate || "").trim();
      if (/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(rawOd)) {
        ngayDatHangCt = rawOd.length === 16 ? rawOd + ":00" : rawOd.slice(0, 19);
      } else if (rawOd) {
        // Có ngày không giờ: giữ yyyy-MM-dd (Sheet serial 00:00) — chỉ khi DH cũng không có giờ
        ngayDatHangCt = ymdDate(rawOd) || formatDateTimeVN();
      } else {
        ngayDatHangCt = formatDateTimeVN();
      }
    }
    // Counter key theo ngày (YYYYMMDD)
    const ngayDat =
      ymdDate(ngayDatHangCt) || ymdDate(order.orderDate) || ymdDate(new Date()) || "";
    const maNcc = order.supplierId;
    const isDuyenHa = ["dha", "btay"].includes(
      String(maNcc || "").toLowerCase()
    );

    const hhRows = await readSheetAsObjects(SHEETS.HH, { year: y }).catch(
      () => [] as Record<string, string>[]
    );
    const hhById = new Map<string, Record<string, string>>();
    for (const r of hhRows) {
      const id = String(r.MaHH || r.MaHh || "").trim();
      if (id) hhById.set(id, r);
    }

    for (const d of details) {
      if (!d.vehicleId || !d.productId || !d.regionId) {
        throw {
          code: "VALIDATION_ERROR",
          message: "Thiếu xe / hàng / khu vực.",
        };
      }
      if (!d.deliveries?.length) {
        throw {
          code: "VALIDATION_ERROR",
          message: "Mỗi xe cần ≥1 dòng kế hoạch giao.",
        };
      }
      const product = hhById.get(String(d.productId).trim());
      const tlCH =
        Number(product?.TyleChiahet || product?.TyleChiaHet || 0) || 0;
      const tenHH = product?.TenHangHoa || d.productId;
      for (const dl of d.deliveries) {
        if (!dl.customerId) {
          throw {
            code: "VALIDATION_ERROR",
            message: "Thiếu khách hàng trên dòng giao.",
          };
        }
        const khg = qty3(Number(dl.plannedQty) || 0);
        if (!(khg > 0)) {
          throw {
            code: "VALIDATION_ERROR",
            message: "KH giao phải > 0.",
          };
        }
        if (!validateStep(khg, tlCH)) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Kế hoạch giao ${tenHH} phải chia hết cho ${tlCH} tấn (hiện ${khg}).`,
          };
        }
      }
    }

    const detailIds = await nextCounterCodes("CT", ngayDat, {
      count: details.length,
      email: user.email,
      year: y,
    });
    const totalGh = details.reduce(
      (s, d) => s + (d.deliveries?.length || 0),
      0
    );
    const deliveryIds = await nextCounterCodes("GH", ngayDat, {
      count: totalGh,
      email: user.email,
      year: y,
    });

    const now = formatDateTimeVN();
    let ghIndex = 0;
    const createdCt: string[] = [];

    for (let idx = 0; idx < details.length; idx++) {
      const d = details[idx];
      const idCt = detailIds[idx];
      const khTotal = qty3(
        (d.deliveries || []).reduce(
          (s, x) => s + (Number(x.plannedQty) || 0),
          0
        )
      );

      await appendSheetRow(
        SHEETS.CT,
        {
          ID_Chitiet: idCt,
          NgayDatHang: ngayDatHangCt,
          MaDon: orderId,
          MaNCC: maNcc,
          MaXe: d.vehicleId,
          MaHH: d.productId,
          SoLuong: khTotal,
          Khuvuc: d.regionId,
          KhoXuat: "",
          GhiChu: d.note || "",
          TrangThaiXe: STATUS_CT.NEW,
          TimeChange: now,
          NgayNhanHang: "",
          ThucNhan: 0,
          User: user.email,
          MaHTVT: d.transportTypeId || "",
          TenHTVT: d.transportTypeName || "",
          IsDuyenHa: isDuyenHa ? "TRUE" : "FALSE",
        },
        y
      );
      createdCt.push(idCt);

      for (const dl of d.deliveries || []) {
        const idGh = deliveryIds[ghIndex++];
        await appendSheetRow(
          SHEETS.GH,
          {
            ID_Giaohang: idGh,
            ID_Chitiet: idCt,
            MaKh: dl.customerId,
            ChitietKh: dl.customerDetail || "",
            KHgiao: qty3(Number(dl.plannedQty) || 0),
            ThucGiao: 0,
            Ngaygiao: "",
            Ghichu: "",
            Deleted: false,
            DeletedAt: "",
            DeletedBy: "",
          },
          y
        );
      }
    }

    // Cập nhật TongSoChitiet
    const newTong = active.length + details.length;
    // Đơn đã gửi → bật GuiLaimail + Đang xử lý (V21 _markOrderChoGuiMailIfSent_)
    const alreadySent =
      Number(order.sendCount || 0) > 0 ||
      order.resendMail ||
      order.pendingMail ||
      !!order.mailSentAt ||
      String(order.status || "").toUpperCase() === "PROCESSING" ||
      String(order.status || "").toUpperCase() === "DONE";
    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        TongSoChitiet: newTong,
        ...(alreadySent
          ? {
              GuiLaimail: true,
              ChoGuiMail: true,
              TrangThaiDon: "Đang xử lý",
            }
          : {}),
      },
      y
    );

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "ADD_DETAIL",
      maDon: orderId,
      targetId: orderId,
      newValue: JSON.stringify({ detailIds: createdCt, count: details.length }),
      year: y,
    });

    const synced = await syncOrderStatusByOrderId(orderId, y).catch(() => null);

    return {
      orderId,
      added: details.length,
      detailIds: createdCt,
      tongSoChitiet: newTong,
      /** Trạng thái đơn sau autoUpdateOrderStatus_ */
      status: synced?.status || order.status,
      ngayDatHangCt: typeof ngayDatHangCt === "string" ? ngayDatHangCt : String(ngayDatHangCt),
    };
  }

    /**
   * Gửi đơn NCC — Strangler V21.
   *
   * Có GAS_SEND_ORDER_URL:
   *   → Uỷ quyền toàn bộ cho GAS `sendOrderEmail` (PDF + mail/Zalo + cập nhật Sheet).
   *   Không ghi Sheet phía Vercel (tránh tăng LanGui 2 lần).
   *
   * Không có GAS:
   *   → Chỉ cập nhật Sheet nội bộ (status/CT/snapshot/log) — không mail/PDF.
   *
   * sendAction: '' | 'send' | 'reset' | 'cancel' | 'markSent' (parity modal late-send V21)
   */
  static async sendOrder(
    orderId: string,
    user: UserContext,
    year?: number,
    sendAction?: string,
    opts?: { resend?: boolean }
  ) {
    // Chỉ ORDER_SEND (hoặc *) — không fallback role (MANAGER không được gửi)
    if (!hasPermission(user, "ORDER_SEND") && !hasPermission(user, "*")) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền gửi đơn" };
    }

    const y = year ?? currentYearVN();
    const action = String(sendAction || "").trim();
    const gasUrl =
      process.env.GAS_SEND_ORDER_URL || process.env.GAS_WEBHOOK_URL || "";

    // Đọc đơn + NCC để biết hình thức gửi (Email / Zalo) — parity V21 HinhThucGui
    let hinhThucGui = "";
    let zaloUserId = "";
    let emailNcc = "";
    let lanGui = 0;
    let guiLaiMail = false;
    try {
      const orders = await OrderRepository.findMany({ year: y });
      const order = orders.find(
        (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
      );
      if (order) {
        lanGui = Number(order.sendCount) || 0;
        guiLaiMail = !!(order as { resendMail?: boolean }).resendMail;
        const nccRows = await readSheetAsObjects(SHEETS.NCC, {});
        const ncc = nccRows.find(
          (r) =>
            String(r.MaNCC || "").trim().toUpperCase() ===
            String(order.supplierId || "").trim().toUpperCase()
        );
        if (ncc) {
          hinhThucGui = String(
            ncc.HinhThucGui || ncc.HinhThucgui || ncc.HinhThuc || ""
          ).trim();
          zaloUserId = String(ncc.ZaloUserId || ncc.ZaloUserID || "").trim();
          emailNcc = String(ncc.EmailNCC || ncc.Email || "").trim();
        }
      }
    } catch (e) {
      console.warn("[sendOrder] load NCC channel", e);
    }
    // V21 MASTER: HinhThucGui = Email | ZALO | APP → so khớp sau toLowerCase
    const hinhNorm = hinhThucGui
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    const channelHint = (() => {
      if (hinhNorm === "app" || hinhNorm.includes("ung dung")) return "app";
      if (hinhNorm === "zalo") return "zalo";
      if (hinhNorm === "email" || hinhNorm === "mail") return "email";
      if (hinhNorm.includes("zalo")) return "zalo";
      if (hinhNorm.includes("mail") || hinhNorm.includes("email")) return "email";
      return hinhNorm || "unknown";
    })();

    // ─── APP: không phụ thuộc GAS (V21 cũng không gửi mail/Zalo) ───
    // Vercel tự ghi LanGui + mark ORDERED + báo mở APP.
    // Gửi muộn (LanGui=0, dayDiff≥1): trả needConfirm để UI mở modal chọn
    // send | reset | cancel | markSent (parity Email/Zalo).
    if (channelHint === "app") {
      if (!isSheetsConfigured()) {
        throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
      }
      const ordersApp = await OrderRepository.findMany({ year: y });
      const orderApp = ordersApp.find(
        (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
      );
      if (!orderApp) {
        throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
      }
      const tenNcc =
        String(orderApp.supplierName || orderApp.supplierId || "").trim() ||
        "nhà cung cấp";
      const lanGuiCur = Number(orderApp.sendCount) || 0;
      const isDha = isDuyenHaNcc(orderApp.supplierId);
      const dayDiff = businessDayDiff(orderApp.orderDate, isDha);
      const lateFirst =
        lanGuiCur === 0 && dayDiff !== null && dayDiff >= 1;

      // Chưa chọn phương án gửi muộn → UI mở SendActionModal
      if (!action && lateFirst) {
        return {
          orderId,
          via: "app" as const,
          needConfirm: true,
          confirmType: "LATE_FIRST_SEND",
          isDuyenHa: isDha,
          dayDiff,
          channel: "app",
          hinhThucGui,
          appGuide: false,
          message:
            `Đơn ${orderId} gửi muộn ${dayDiff} ngày (hình thức APP — ${tenNcc}).\n` +
            `Chọn cách xử lý: Gửi bình thường / Reset đơn / Hủy / Đánh dấu đã gửi.`,
        };
      }

      // User chọn "cancel" trên modal muộn
      if (action === "cancel") {
        return {
          orderId,
          via: "app" as const,
          needConfirm: false,
          channel: "app",
          hinhThucGui,
          cancelled: true,
          message: "Đã hủy thao tác gửi đơn (APP).",
        };
      }

      // markSent: ghi nhận đã gửi ngoài hệ thống, tăng LanGui, không bắt buộc mở app
      // send (hoặc rỗng khi không muộn): cập nhật Sheet + hướng dẫn APP
      const markOnly = action === "markSent";
      const lanGuiNext = lanGuiCur + 1;
      const timeLabel = formatDateTimeVN(new Date());
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        orderId,
        {
          LanGui: lanGuiNext,
          timeGuimail: timeLabel,
          ChoGuiMail: false,
          GuiLaimail: false,
          TrangThaiDon: STATUS_DON.PROCESSING,
          FileDonhang: orderApp.orderFile || "",
        },
        y
      );
      const { DetailRepository } = await import(
        "@/repositories/detail.repository"
      );
      const details = await DetailRepository.findMany({ year: y, orderId });
      let ctUpdated = 0;
      for (const ct of details) {
        const st = String(ct.status || "").toUpperCase();
        if (
          st === "NEW" ||
          st === "" ||
          String(ct.status) === STATUS_CT.NEW ||
          String(ct.status).includes("Mới")
        ) {
          await updateSheetRowByKey(
            SHEETS.CT,
            "ID_Chitiet",
            ct.detailId,
            { TrangThaiXe: STATUS_CT.ORDERED, TimeChange: timeLabel },
            y
          );
          ctUpdated++;
        }
      }
      await writeAudit({
        email: user.email,
        role: user.role,
        action: markOnly ? "SEND_ORDER_APP_MARK_SENT" : "SEND_ORDER_APP",
        maDon: orderId,
        targetId: orderId,
        newValue: JSON.stringify({
          lanGui: lanGuiNext,
          ctUpdated,
          channel: "app",
          sendAction: action || "send",
        }),
        lyDo: markOnly
          ? "APP — đánh dấu đã gửi (xử lý ngoài hệ thống)"
          : "Hình thức APP — cập nhật Sheet, hướng dẫn mở app NCC",
        year: y,
      });
      return {
        orderId,
        via: "app" as const,
        needConfirm: false,
        notifiedNcc: !markOnly,
        channel: "app",
        hinhThucGui,
        appGuide: !markOnly,
        lanGui: lanGuiNext,
        ctUpdated,
        message: markOnly
          ? `Đã đánh dấu đơn ${orderId} đã gửi (Lần ${lanGuiNext}). Hình thức APP.`
          : `Đơn hàng ${orderId} đã sẵn sàng (Lần gửi ${lanGuiNext}).\n` +
            `Vui lòng mở APP của ${tenNcc} để đặt hàng.\n` +
            `Hệ thống không gửi Email/Zalo cho hình thức APP.`,
      };
    }

    // ─── Nhánh 1: GAS sendOrderEmail (Email / Zalo) ───
    if (gasUrl) {
      // V21 sendOrderEmail(maDon, email, action|null)
      // action: null | send | reset | cancel | markSent
      // Shared postGasWebhook: redirect + HTML detect + timeout + idempotency (P0)
      const GAS_TIMEOUT_MS = 55_000;
      const baselineLanGui = Number(lanGui) || 0;
      const WINDOW_MS = 5 * 60 * 1000;
	const windowId = Math.floor(Date.now() / WINDOW_MS);
	const idempotencyKey = `send:${orderId}:w${windowId}:${action || "default"}`;
      const payload: Record<string, unknown> = {
        action: "sendOrderEmail",
        maDon: orderId,
        email: user.email,
        sendAction: action || null,
        idempotencyKey,
      };

      let gasRes: {
        status: number;
        body: Record<string, unknown>;
        raw: string;
        aborted?: boolean;
        fromIdempotencyCache?: boolean;
      };

      /** Sau timeout/abort: reload Sheet — nếu LanGui đã tăng thì coi GAS đã gửi (tránh double-send). */
      async function resolveAfterGasAbort(): Promise<{
        orderId: string;
        via: "gas";
        needConfirm: false;
        notifiedNcc: boolean;
        channel: string;
        hinhThucGui: string;
        message: string;
        recoveredFromSheet: true;
      } | null> {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const afterOrders = await OrderRepository.findMany({ year: y });
            const after = afterOrders.find(
              (o) =>
                String(o.orderId).toUpperCase() ===
                String(orderId).toUpperCase()
            );
            const afterLanGui = Number(after?.sendCount) || 0;
            if (afterLanGui > baselineLanGui) {
              return {
                orderId,
                via: "gas" as const,
                needConfirm: false as const,
                notifiedNcc: true,
                channel: channelHint,
                hinhThucGui,
                recoveredFromSheet: true as const,
                message:
                  `Đã gửi đơn qua GAS (xác nhận Sheet lần ${attempt + 1}: ` +
                  `LanGui ${baselineLanGui} → ${afterLanGui}). Không bấm gửi lại.`,
              };
            }
          } catch (e) {
            console.error(
              `[sendOrder] recover attempt ${attempt + 1} failed`,
              e
            );
          }
        }
        return null;
      }

      gasRes = await postGasWebhook(payload, {
        timeoutMs: GAS_TIMEOUT_MS,
        idempotencyKey,
      });

      // Timeout/abort → poll LanGui (GAS có thể đã gửi sau khi Vercel cắt)
      if (gasRes.aborted || gasRes.body?._idempotencyInFlight) {
        if (gasRes.aborted) {
          const recovered = await resolveAfterGasAbort();
          if (recovered) {
            rememberGasIdempotency(idempotencyKey, {
              status: 200,
              raw: "",
              body: { success: true, recoveredFromSheet: true },
            });
            await writeAudit({
              email: user.email,
              role: user.role,
              action: "SEND_ORDER_GAS_RECOVERED",
              maDon: orderId,
              targetId: orderId,
              newValue: JSON.stringify({
                baselineLanGui,
                message: recovered.message,
              }),
              year: y,
            });
            return recovered;
          }
          throw {
            code: "GAS_SEND_FAILED",
            message:
              `GAS không phản hồi trong ${GAS_TIMEOUT_MS / 1000}s và Sheet chưa tăng LanGui. ` +
              `Đợi ~30s rồi kiểm tra cột LanGui trước khi gửi lại (tránh trùng email).`,
          };
        }
        throw {
          code: "GAS_SEND_IN_FLIGHT",
          message: String(
            gasRes.body?.error ||
              "Đang xử lý gửi trùng — đợi rồi kiểm tra LanGui trên Sheet."
          ),
        };
      }

      const gasBody = gasRes.body;
      console.info("[sendOrder] GAS response", {
        maDon: orderId,
        status: gasRes.status,
        fromCache: gasRes.fromIdempotencyCache || false,
        bodyPreview: JSON.stringify(gasBody).slice(0, 500),
        hint: gasBody._gasHtml ? "GAS trả HTML" : undefined,
      });

      /** Làm sạch message — không bao giờ alert HTML */
      const cleanMsg = (v: unknown, fallback: string) => {
        const s = String(v ?? "").trim();
        if (!s) return fallback;
        if (
          /^<!DOCTYPE/i.test(s) ||
          /^<html[\s>]/i.test(s) ||
          s.includes("<head") ||
          s.includes("ppConfig")
        ) {
          return fallback;
        }
        return s.slice(0, 400);
      };

      // needConfirm LATE_FIRST_SEND — UI hiện modal (mọi kênh kể cả APP)
      if (gasBody.needConfirm) {
        return {
          orderId,
          via: "gas" as const,
          needConfirm: true,
          confirmType: gasBody.confirmType || "LATE_FIRST_SEND",
          isDuyenHa: !!gasBody.isDuyenHa,
          dayDiff: gasBody.dayDiff,
          channel: channelHint,
          hinhThucGui,
          message: cleanMsg(
            gasBody.error || gasBody.message,
            "Cần xác nhận gửi muộn"
          ),
          gas: gasBody,
        };
      }

      if (
        gasBody.success === false ||
        gasBody._gasHtml === true ||
        (gasRes.status >= 400 && gasBody.success !== true)
      ) {
        // HTML/timeout body: GAS có thể đã gửi xong — recover LanGui trước khi báo lỗi
        const recovered = await resolveAfterGasAbort();
        if (recovered) {
          await writeAudit({
            email: user.email,
            role: user.role,
            action: "SEND_ORDER_GAS_RECOVERED",
            maDon: orderId,
            targetId: orderId,
            newValue: JSON.stringify({
              baselineLanGui,
              viaHtmlOrFail: true,
              message: recovered.message,
            }),
            year: y,
          });
          return recovered;
        }
        const errMsg = cleanMsg(
          gasBody.error || gasBody.message,
          `GAS HTTP ${gasRes.status}`
        );
        const hint =
          /unauthorized/i.test(errMsg)
            ? " — Kiểm tra WEBHOOK_SECRET (GAS) khớp WEBHOOK_SECRET/GAS_WEBHOOK_SECRET (Vercel)."
            : /unknown action/i.test(errMsg)
              ? " — doPost chưa nhận action sendOrderEmail (deploy Web App mới)."
              : gasBody._gasHtml
                ? " — GAS trả HTML; kiểm tra LanGui trên Sheet trước khi gửi lại."
                : "";
        throw {
          code: "GAS_SEND_FAILED",
          message: errMsg + hint,
          gas: { ...gasBody, rawPreview: undefined },
        };
      }

      await writeAudit({
        email: user.email,
        role: user.role,
        action: "SEND_ORDER_GAS",
        maDon: orderId,
        targetId: orderId,
        newValue: JSON.stringify({
          sendAction: action,
          notifiedNcc: gasBody.notifiedNcc,
          message: cleanMsg(gasBody.message, "ok"),
        }),
        year: y,
      });

      const notified = gasBody.notifiedNcc !== false;
      // Nhánh GAS chỉ còn email/zalo (APP return sớm phía trên)
      let defaultMsg = "Đã gửi đơn qua GAS.";
      if (channelHint === "zalo") {
        defaultMsg = notified
          ? "Đã gửi đơn qua Zalo (GAS)."
          : "GAS đã xử lý đơn nhưng có thể chưa gửi được Zalo — kiểm tra ZaloUserId trên DM_NCC.";
        if (!zaloUserId) {
          defaultMsg =
            "Hình thức gửi là Zalo nhưng DM_NCC thiếu ZaloUserId — bổ sung mã Zalo NCC rồi gửi lại.";
        }
      } else if (channelHint === "email") {
        defaultMsg = "Đã gửi đơn qua Email (GAS).";
      }
      return {
        orderId,
        via: "gas" as const,
        needConfirm: false,
        notifiedNcc: notified,
        channel: channelHint,
        hinhThucGui,
        appGuide: false,
        zaloUserId: zaloUserId ? "(có)" : "(thiếu)",
        message: cleanMsg(gasBody.message, defaultMsg),
        gas: gasBody,
      };
    }

    // ─── Nhánh 2: Không GAS — chỉ Sheet (không mail/PDF) ───
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
    }
    const orders = await OrderRepository.findMany({ year: y });
    const order = orders.find(
      (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
    );
    if (!order) {
      throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
    }

    const lanGuiNext = (Number(order.sendCount) || 0) + 1;
    const timeLabel = formatDateTimeVN(new Date());

    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        LanGui: lanGuiNext,
        timeGuimail: timeLabel,
        ChoGuiMail: false,
        GuiLaimail: false,
        TrangThaiDon: STATUS_DON.PROCESSING,
        FileDonhang: order.orderFile || "",
      },
      y
    );

    const { DetailRepository } = await import("@/repositories/detail.repository");
    const details = await DetailRepository.findMany({ year: y, orderId });
    let ctUpdated = 0;
    for (const ct of details) {
      const st = String(ct.status || "").toUpperCase();
      if (
        st === "NEW" ||
        st === "" ||
        String(ct.status) === STATUS_CT.NEW ||
        String(ct.status).includes("Mới")
      ) {
        await updateSheetRowByKey(
          SHEETS.CT,
          "ID_Chitiet",
          ct.detailId,
          {
            TrangThaiXe: STATUS_CT.ORDERED,
            TimeChange: timeLabel,
          },
          y
        );
        ctUpdated++;
      }
    }

    try {
      await appendSheetRow(
        SHEETS.SNAPSHOT,
        {
          MaDon: orderId,
          LanGui: lanGuiNext,
          SnapshotJSON: JSON.stringify({
            maDon: orderId,
            lanGui: lanGuiNext,
            at: new Date().toISOString(),
            by: user.email,
          }),
          ThoiGianLuu: timeLabel,
        },
        y
      );
    } catch (e) {
      console.warn("[sendOrder] snapshot skip", e);
    }

    try {
      await appendSheetRow(
        SHEETS.LOG_GUI_MAIL,
        {
          "Thời gian": timeLabel,
          MaDon: orderId,
          NCC: order.supplierName || order.supplierId || "",
          Email: "",
          "Lần gửi": lanGuiNext,
          "Ghi chú": "Gửi Sheet-only (chưa cấu hình GAS_SEND_ORDER_URL)",
          "Link PDF": order.orderFile || "",
        },
        y
      );
    } catch (e) {
      console.warn("[sendOrder] LogGuiMail skip", e);
    }

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "SEND_ORDER_SHEET_ONLY",
      maDon: orderId,
      targetId: orderId,
      newValue: JSON.stringify({ lanGui: lanGuiNext, ctUpdated }),
      year: y,
    });

    return {
      orderId,
      via: "sheet" as const,
      lanGui: lanGuiNext,
      ctUpdated,
      needConfirm: false,
      notifiedNcc: false,
      message:
        "Đã cập nhật trạng thái trên Sheet. Chưa gửi mail/PDF — cấu hình GAS_SEND_ORDER_URL để uỷ quyền GAS sendOrderEmail.",
    };
  }



  /**
   * Reset đơn hàng (parity V21 resetDuyenHaOrder — áp dụng mọi NCC).
   * Ràng buộc thời gian (business day, Duyên Hà cutoff 14h):
   * - LanGui === 0 (chưa gửi): dayDiff >= 1
   * - LanGui > 0 (đã gửi): dayDiff >= 1 (Duyên Hà) hoặc >= 2 (đơn thường)
   * Full: chưa xe nhận → đổi MaDon + ngày, CT → Mới tạo, LanGui=0
   * Partial: có xe đã nhận → tạo đơn mới, chuyển CT chưa nhận
   */
  static async resetOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    const role = String(user.role || "").toUpperCase();
    if (
      !["ADMIN", "PURCHASE", "MANAGER"].includes(role) &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Chỉ admin/purchase/manager được reset đơn",
      };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
    }
    const y = year ?? currentYearVN();
    const orders = await OrderRepository.findMany({ year: y });
    const order = orders.find(
      (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
    );
    if (!order) {
      throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
    }
    if (String(order.status).toUpperCase() === "CANCEL") {
      throw { code: "INVALID_STATE", message: "Đơn đã hủy, không thể reset." };
    }

    // 1) Thời gian — parity canResetOrder (chưa gửi ≥1 ngày; đã gửi DHA 1 / khác 2)
    const isDha = isDuyenHaNcc(order.supplierId);
    const sendCount = Number(order.sendCount) || 0;
    const neverSent = sendCount === 0;
    const thresholdDays = neverSent ? 1 : isDha ? 1 : 2;
    const dayDiff = businessDayDiff(order.orderDate, isDha);
    if (dayDiff === null) {
      throw {
        code: "INVALID_STATE",
        message: "Không xác định được ngày đặt hàng.",
      };
    }
    if (dayDiff < thresholdDays) {
      throw {
        code: "TOO_EARLY",
        message: neverSent
          ? `Đơn chưa gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`
          : `Đơn ${isDha ? "Duyên Hà" : "NCC này"} đã gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`,
      };
    }

    const { DetailRepository } = await import(
      "@/repositories/detail.repository"
    );
    const details = (await DetailRepository.findMany({ year: y, orderId })).filter(
      (d) => {
        const st = String(d.status || "").toUpperCase();
        return st !== "DELETE";
      }
    );

    const chuaNhan = details.filter((d) => {
      const st = String(d.status || "").toUpperCase();
      return (Number(d.actualReceived) || 0) === 0 && st !== "CANCEL";
    });
    const daNhanHoacHuy = details.filter(
      (d) => !chuaNhan.some((c) => c.detailId === d.detailId)
    );

    if (!chuaNhan.length) {
      throw {
        code: "INVALID_STATE",
        message: "Tất cả các xe đều đã nhận hoặc đã hủy, không cần reset.",
      };
    }

    // Chốt đủ 2 điều kiện: quá hạn ngày + còn CT chưa nhận
    const fullCheck = canResetOrder({
      status: order.status,
      orderDate: order.orderDate,
      supplierId: order.supplierId,
      sendCount: order.sendCount,
      hasUnreceivedVehicle: true,
    });
    if (!fullCheck.ok) {
      throw {
        code: "TOO_EARLY",
        message: fullCheck.error || "Chưa đủ điều kiện reset đơn.",
      };
    }

    const now = new Date();
    const clock = resolveMaDonClock(order.supplierId, now);
    let newMaDon = generateMaDon(order.supplierId, clock);
    const existing = new Set(orders.map((o) => String(o.orderId)));
    for (let i = 0; i < 30 && existing.has(newMaDon); i++) {
      const d = new Date(clock.getTime() + (i + 1) * 1000);
      newMaDon = generateMaDon(order.supplierId, d);
    }
    if (existing.has(newMaDon)) {
      throw {
        code: "MA_DON_CONFLICT",
        message: "Không tạo được mã đơn mới không trùng.",
      };
    }

    const timeLabel = formatDateTimeVN(new Date());
    const newNgay = todayYmdVN();

    if (daNhanHoacHuy.length === 0) {
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        orderId,
        {
          MaDon: newMaDon,
          NgayDatHang: newNgay,
          LanGui: 0,
          TrangThaiDon: STATUS_DON.NEW,
          ChoGuiMail: true,
          GuiLaimail: false,
          timeGuimail: "",
          FileDonhang: "",
          TongSoChitiet: chuaNhan.length,
          ChitietHuy: 0,
        },
        y
      );
      for (const ct of details) {
        await updateSheetRowByKey(
          SHEETS.CT,
          "ID_Chitiet",
          ct.detailId,
          {
            MaDon: newMaDon,
            NgayDatHang: newNgay,
            TrangThaiXe: STATUS_CT.NEW,
            TimeChange: timeLabel,
          },
          y
        );
      }
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "RESET_ORDER_FULL",
        maDon: newMaDon,
        targetId: orderId,
        oldValue: orderId,
        newValue: newMaDon,
        lyDo: `Reset toàn bộ đơn (dayDiff=${dayDiff}, threshold=${thresholdDays}, LanGui=${sendCount})`,
        year: y,
      });
      return {
        mode: "full" as const,
        oldMaDon: orderId,
        newMaDon,
        movedDetails: details.length,
        dayDiff,
        threshold: thresholdDays,
        message: `Đã reset đơn: ${orderId} → ${newMaDon}`,
      };
    }

    // Partial
    await appendSheetRow(
      SHEETS.DH,
      {
        MaDon: newMaDon,
        NgayDatHang: newNgay,
        MaNCC: order.supplierId,
        LanGui: 0,
        TrangThaiDon: STATUS_DON.NEW,
        TongSoChitiet: chuaNhan.length,
        ChitietHuy: 0,
        FileDonhang: "",
        ChoGuiMail: true,
        timeGuimail: "",
        GuiLaimail: false,
        User: order.createdBy || user.email,
      },
      y
    );
    for (const ct of chuaNhan) {
      await updateSheetRowByKey(
        SHEETS.CT,
        "ID_Chitiet",
        ct.detailId,
        {
          MaDon: newMaDon,
          NgayDatHang: newNgay,
          TrangThaiXe: STATUS_CT.NEW,
          TimeChange: timeLabel,
        },
        y
      );
    }
    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        TongSoChitiet: daNhanHoacHuy.length,
        ChoGuiMail: false,
        GuiLaimail: false,
      },
      y
    );

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "RESET_ORDER_PARTIAL",
      maDon: newMaDon,
      targetId: orderId,
      oldValue: orderId,
      newValue: newMaDon,
      lyDo: `Tách ${chuaNhan.length} xe chưa nhận (dayDiff=${dayDiff})`,
      year: y,
    });

    return {
      mode: "partial" as const,
      oldMaDon: orderId,
      newMaDon,
      movedDetails: chuaNhan.length,
      keptDetails: daNhanHoacHuy.length,
      dayDiff,
      threshold: thresholdDays,
      message: `Đã tách đơn: ${chuaNhan.length} xe → ${newMaDon} (giữ ${orderId})`,
    };
  }

  /** @deprecated alias — dùng resetOrder */
  static async resetDuyenHaOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    return this.resetOrder(orderId, user, year);
  }

}
