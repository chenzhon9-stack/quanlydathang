import { formatDateTimeVN, ymdDate, todayYmdVN, currentYearVN } from "@/lib/sheets/date";
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
import { STATUS_DON, STATUS_CT } from "@/lib/status";
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
    const items = orders.slice(start, start + pageSize);

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
}
