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
  resolveAllowedSupplierIds,
} from "@/lib/scope";
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

    // OWNER: DonHang.User
    if (scope.scopeType === "OWNER" && scope.ownerEmail) {
      const em = scope.ownerEmail.toLowerCase();
      orders = orders.filter(
        (o) => (o.createdBy || "").toLowerCase() === em
      );
    }

    // MANAGEMENT: intersection User.Quanly ∩ NCC.Quanly
    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      orders = filterBySupplierIds(orders, allowed);
    }

    const nccMap = await MasterRepository.nccNames();
    orders = orders.map((o) => ({
      ...o,
      supplierName: o.supplierName || nccMap[o.supplierId] || o.supplierId,
    }));

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = orders.length;
    const start = (page - 1) * pageSize;
    let items = orders.slice(start, start + pageSize);

    // V21: canReset chỉ tính cho trang hiện tại + cần còn xe chưa nhận
    // Load CT theo năm một lần, gom hasUnreceived theo MaDon
    const hasUnreceived = new Map<string, boolean>();
    try {
      const { DetailRepository } = await import(
        "@/repositories/detail.repository"
      );
      const allCt = await DetailRepository.findMany({ year: filter.year });
      for (const d of allCt) {
        const st = String(d.status || "").toUpperCase();
        if (st === "DELETE") continue;
        const oid = String(d.orderId || "");
        if (!oid) continue;
        const unrecv =
          (Number(d.actualReceived) || 0) === 0 && st !== "CANCEL";
        if (unrecv) {
          hasUnreceived.set(oid, true);
        } else if (!hasUnreceived.has(oid)) {
          hasUnreceived.set(oid, false);
        }
      }
    } catch (e) {
      console.error("[listOrders] canReset CT load", e);
    }

    items = items.map((o) => {
      const reset = canResetOrder({
        status: o.status,
        orderDate: o.orderDate,
        supplierId: o.supplierId,
        sendCount: o.sendCount,
        hasUnreceivedVehicle: hasUnreceived.get(o.orderId) === true,
      });
      return { ...o, canReset: reset.ok };
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

    if (
      scope.scopeType === "OWNER" &&
      scope.ownerEmail &&
      (order.createdBy || "").toLowerCase() !== scope.ownerEmail.toLowerCase()
    ) {
      throw {
        code: "SCOPE_DENIED",
        message: "Không thuộc phạm vi dữ liệu của bạn",
      };
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      if (
        allowed &&
        order.supplierId &&
        !allowed.has(order.supplierId)
      ) {
        throw {
          code: "SCOPE_DENIED",
          message: "NCC không thuộc nhóm quản lý của bạn",
        };
      }
    }

    return order;
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

    // Trùng xe + hàng trong payload
    const seen = new Set<string>();
    for (const d of details) {
      const key = `${String(d.vehicleId).trim()}|${String(d.productId).trim()}`;
      if (seen.has(key)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Trùng xe/hàng trong đơn: ${d.vehicleId} / ${d.productId}`,
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
    const seen = new Set(
      active.map((d) => `${d.vehicleId}|${d.productId}`)
    );
    for (const d of details) {
      const key = `${String(d.vehicleId).trim()}|${String(d.productId).trim()}`;
      if (seen.has(key)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Trùng xe/hàng với đơn hiện tại: ${d.vehicleId} / ${d.productId}`,
        };
      }
      seen.add(key);
    }

    const { ymdDate } = await import("@/lib/sheets/date");
    const { nextCounterCodes } = await import("@/lib/sheets/counter");
    const { appendSheetRow, readSheetAsObjects } = await import(
      "@/lib/sheets/dal"
    );
    const { qty3, validateStep } = await import("@/lib/business-rules");
    const { writeAudit } = await import("@/lib/sheets/audit");

    const ngayDat =
      ymdDate(order.orderDate) || ymdDate(new Date()) || "";
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
          NgayDatHang: ngayDat,
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
    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        TongSoChitiet: newTong,
        // đơn đã gửi → bật gửi lại nếu có LanGui
        ...(Number(order.sendCount || 0) > 0 || order.resendMail
          ? { GuiLaimail: true, ChoGuiMail: true }
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

    await syncOrderStatusByOrderId(orderId, y).catch(() => null);

    return {
      orderId,
      added: details.length,
      detailIds: createdCt,
      tongSoChitiet: newTong,
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
    sendAction?: string
  ) {
    if (
      !hasPermission(user, "ORDER_SEND") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      if (
        !["ADMIN", "PURCHASE", "MANAGER", "DISPATCHER"].includes(
          String(user.role || "").toUpperCase()
        )
      ) {
        throw { code: "PERMISSION_DENIED", message: "Không có quyền gửi đơn" };
      }
    }

    const y = year ?? currentYearVN();
    const action = String(sendAction || "").trim();
    const gasUrl =
      process.env.GAS_SEND_ORDER_URL || process.env.GAS_WEBHOOK_URL || "";

    // ─── Nhánh 1: Uỷ quyền GAS (mail/PDF/Zalo + ghi Sheet) ───
    if (gasUrl) {
      const secret = (process.env.GAS_WEBHOOK_SECRET || "").trim();
      const payload = {
        action: "sendOrderEmail",
        maDon: orderId,
        email: user.email,
        sendAction: action,
        year: y,
        ...(secret ? { secret } : {}),
      };
      const bodyStr = JSON.stringify(payload);

      // GAS Web App thường 302 → googleusercontent; cần POST lại URL cuối (tránh mất body).
      async function postGas(url: string, canRedirect = true): Promise<{
        status: number;
        body: Record<string, unknown>;
        raw: string;
      }> {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: bodyStr,
          redirect: canRedirect ? "manual" : "follow",
        });
        // 3xx — follow bằng POST (Node mặc định có thể đổi thành GET)
        if (canRedirect && res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (loc) {
            return postGas(loc, false);
          }
        }
        const raw = await res.text();
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {
            success: false,
            error:
              raw.slice(0, 300) ||
              `GAS HTTP ${res.status} (không phải JSON — kiểm tra Deploy Web App / doPost)`,
          };
        }
        return { status: res.status, body, raw };
      }

      let gasRes: { status: number; body: Record<string, unknown>; raw: string };
      try {
        gasRes = await postGas(gasUrl);
      } catch (e) {
        throw {
          code: "GAS_SEND_FAILED",
          message: `Không gọi được GAS: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const gasBody = gasRes.body;
      console.info("[sendOrder] GAS response", gasRes.status, JSON.stringify(gasBody).slice(0, 500));

      // needConfirm LATE_FIRST_SEND — UI hiện modal
      if (gasBody.needConfirm) {
        return {
          orderId,
          via: "gas" as const,
          needConfirm: true,
          confirmType: gasBody.confirmType || "LATE_FIRST_SEND",
          isDuyenHa: !!gasBody.isDuyenHa,
          dayDiff: gasBody.dayDiff,
          message: String(gasBody.error || gasBody.message || "Cần xác nhận gửi muộn"),
          gas: gasBody,
        };
      }

      if (gasBody.success === false || (gasRes.status >= 400 && gasBody.success !== true)) {
        const errMsg = String(
          gasBody.error || gasBody.message || `GAS HTTP ${gasRes.status}`
        );
        // Gợi ý lỗi secret phổ biến
        const hint =
          /unauthorized/i.test(errMsg)
            ? " — Kiểm tra WEBHOOK_SECRET (GAS) khớp GAS_WEBHOOK_SECRET (Vercel), hoặc xóa cả hai để thử."
            : /unknown action/i.test(errMsg)
              ? " — doPost chưa nhận action sendOrderEmail (deploy bản Web App mới)."
              : "";
        throw {
          code: "GAS_SEND_FAILED",
          message: errMsg + hint,
          gas: gasBody,
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
          message: gasBody.message,
        }),
        year: y,
      });

      return {
        orderId,
        via: "gas" as const,
        needConfirm: false,
        notifiedNcc: gasBody.notifiedNcc !== false,
        message: String(gasBody.message || "Đã gửi đơn qua GAS (mail/PDF/Zalo)"),
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

    const lanGui = (Number(order.sendCount) || 0) + 1;
    const timeLabel = formatDateTimeVN(new Date());

    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        LanGui: lanGui,
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
          LanGui: lanGui,
          SnapshotJSON: JSON.stringify({
            maDon: orderId,
            lanGui,
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
          "Lần gửi": lanGui,
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
      newValue: JSON.stringify({ lanGui, ctUpdated }),
      year: y,
    });

    return {
      orderId,
      via: "sheet" as const,
      lanGui,
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

    // 1) Thời gian + status (chưa check CT)
    const isDha = isDuyenHaNcc(order.supplierId);
    const threshold = isDha ? 1 : 2;
    const dayDiff = businessDayDiff(order.orderDate, isDha);
    const lanGui = Number(order.sendCount) || 0;
    if (
      dayDiff === null ||
      (lanGui > 0 && dayDiff < threshold) ||
      (lanGui === 0 && dayDiff < 1)
    ) {
      throw {
        code: "TOO_EARLY",
        message: isDha
          ? "Chỉ được reset đơn Duyên Hà sau 1 ngày kể từ ngày đặt."
          : "Chỉ được reset đơn sau 2 ngày kể từ ngày đặt.",
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
        lyDo: `Reset toàn bộ đơn (dayDiff=${dayDiff}, threshold=${threshold}, LanGui=${lanGui})`,
        year: y,
      });
      return {
        mode: "full" as const,
        oldMaDon: orderId,
        newMaDon,
        movedDetails: details.length,
        dayDiff,
        threshold,
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
      threshold,
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
