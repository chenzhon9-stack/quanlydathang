import { writeAudit } from "@/lib/sheets/audit";
import type { AccessScope, Delivery, UserContext } from "@/types";
import { hasPermission, resolveScope, isAdminRole } from "@/lib/auth";
import {
  resolveAllowedSupplierIds,
  resolveAllowedCustomerIds,
  resolveOwnerOrderIdSet,
  filterByOwnerOrderIds,
  filterByCustomerIds,
  applyListScopeFilter,
} from "@/lib/scope";
import { DeliveryRepository } from "@/repositories/delivery.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { ReportRepository } from "@/repositories/report.repository";
import { updateSheetRowByKey, appendSheetRow, readSheetAsObjects } from "@/lib/sheets/dal";
import {
  EPS,
  qty3,
  validateStep,
  validateDeliveryDate,
  validateTolerance,
  normalizeHaohut,
  computeDetailStatus,
} from "@/lib/business-rules";
import { SHEETS } from "@/lib/sheets/constants";
import { mapGiaMuaSheetRow, resolveDonGiaMua } from "@/lib/finance/giamua";
import type { GiaMuaRow } from "@/lib/finance/giamua";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { todayYmdVN, STATUS_CT } from "@/lib/status";
import { DetailRepository } from "@/repositories/detail.repository";
import { OrderRepository } from "@/repositories/order.repository";
import { syncOrderStatusByDetailId } from "@/lib/sync-order-status";
import { newDeliveryId, isTempClientId } from "@/lib/sheets/counter";
import {ymdDate, formatDateTimeVN, currentYearVN, defaultListDateRange} from "@/lib/sheets/date";
import {
  markOrderResendIfSent,
  numClose,
} from "@/lib/order-resend";
import {
  defaultPlanKhFromPhanLoai,
  isAcghangBufferKh,
  resolveAcghangOnSave,
} from "@/lib/default-plan-kh";
import {
  assertOrderInScope,
  isVirtualCustomerId,
  loadVirtualCustomerSet,
  VIRTUAL_CUSTOMER_REAL_MSG,
} from "@/lib/write-guards";

export class DeliveryService {
  static async listDeliveries(
    filter: {
      year?: number;
      fromDate?: string;
      toDate?: string;
      /**
       * Trường ngày dùng để lọc from/to:
       * - order (mặc định): ngày đặt lệnh (CT.NgayDatHang)
       * - delivery: ngày giao (GH.Ngaygiao / deliveryDate)
       */
      dateField?: "order" | "delivery";
      detailId?: string;
      customerId?: string;
      page?: number;
      pageSize?: number;
      /** Export: trả toàn bộ, không phân trang */
      all?: boolean;
      /** Export (V21 getDeliveries): thêm dòng CT Hủy xe chưa có GH active, khGiao = SoLuong CT */
      includeCancelNoGh?: boolean;
      /** Export: gắn đơn giá mua (V21 resolveGiaLocal_) */
      withPrice?: boolean;
      /** Export: ngày đặt TĂNG dần → mã xe (UI mặc định giảm dần) */
      sortAsc?: boolean;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "DELIVERY_VIEW") &&
      !hasPermission(user, "ORDER_VIEW") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem giao hàng",
      };
    }

    // Lọc from/to theo dateField (order = ngày đặt; delivery = ngày giao).
    const {
      fromDate,
      toDate,
      dateField: dateFieldRaw,
      all: _all,
      includeCancelNoGh,
      withPrice: withPriceReq,
      sortAsc,
      ...repoFilter
    } = filter;
    const dateField: "order" | "delivery" =
      dateFieldRaw === "delivery" ? "delivery" : "order";
    // Đơn giá mua: CHỈ admin — role khác bị bỏ qua dù client gửi withPrice
    const withPrice = !!withPriceReq && isAdminRole(user);
    let rows = await DeliveryRepository.findMany(repoFilter);

    // Enrich trước để có orderId / orderDate từ CT (GH không có MaDon)
    const year = filter.year ?? currentYearVN();
        const [khMap, xeMap, hhMap, details, htvtMap, nccSend, dvtMap, xeDvt] = await Promise.all([
      MasterRepository.khNames().catch(() => ({} as Record<string, string>)),
      MasterRepository.xeNames().catch(() => ({} as Record<string, string>)),
      MasterRepository.hhNames().catch(() => ({} as Record<string, string>)),
      DetailRepository.findMany({ year }).catch(() => []),
      MasterRepository.htvtNames().catch(() => ({} as Record<string, string>)),
      MasterRepository.nccSendMethods().catch(() => ({} as Record<string, string>)),
      MasterRepository.dvtNames().catch(() => ({} as Record<string, string>)),
      MasterRepository.xeDvtMap().catch(() => ({} as Record<string, string>)),
    ]);
    const resolveSend = (sid?: string) => {
      const k = String(sid || "").trim();
      if (!k) return "";
      return nccSend[k] || nccSend[k.toUpperCase()] || nccSend[k.toLowerCase()] || "";
    };
    const ctById = new Map(
      details.map((ct) => [String(ct.detailId || "").trim(), ct])
    );

    // Gắn orderId + supplierId + vehicleId từ CT trước khi lọc scope
    // (Sale/View: KH ∪ ĐVVT theo xe — cần vehicleId trước filter)
    rows = rows.map((d: Delivery) => {
      const ct = ctById.get(String(d.detailId || "").trim());
      return {
        ...d,
        orderId: d.orderId || ct?.orderId,
        supplierId: d.supplierId || ct?.supplierId,
        vehicleId: d.vehicleId || ct?.vehicleId,
      };
    });

    // V21 getDeliveries BƯỚC 9: CT Hủy xe chưa có GH active → 1 dòng, khGiao = CT.SoLuong
    if (includeCancelNoGh && !filter.customerId) {
      const hasGh = new Set(rows.map((d) => String(d.detailId || "").trim()));
      for (const ct of details) {
        const id = String(ct.detailId || "").trim();
        if (!id || hasGh.has(id)) continue;
        if (filter.detailId && filter.detailId !== id) continue;
        const stU = String(ct.status || "").trim().toUpperCase();
        if (stU !== "CANCEL" && stU !== "HỦY XE") continue;
        rows.push({
          deliveryId: "",
          detailId: id,
          orderId: ct.orderId,
          supplierId: ct.supplierId,
          vehicleId: ct.vehicleId,
          customerId: "",
          plannedQty: Number(ct.quantity) || 0,
          actualQty: 0,
        } as Delivery);
      }
    }

    // V21.07 multi-role: OWNER ∪ MANAGEMENT(NCC) ∪ OWN_CUSTOMER(KH ∪ ĐVVT)
    rows = await applyListScopeFilter(rows, scope, year);
    rows = rows.map((d: Delivery) => {
      const ct = ctById.get(String(d.detailId || "").trim());
      const status = ct?.status || d.detailStatus;
      const supplierId = d.supplierId || ct?.supplierId;
      return {
        ...d,
        customerName:
          d.customerName || khMap[d.customerId] || d.customerId,
        orderDate: d.orderDate || ct?.orderDate || "",
        vehicleId: d.vehicleId || ct?.vehicleId,
        vehiclePlate:
          d.vehiclePlate ||
          (ct?.vehicleId ? xeMap[String(ct.vehicleId)] : undefined) ||
          ct?.vehicleId,
        productId: d.productId || ct?.productId,
        productName:
          d.productName ||
          (ct?.productId ? hhMap[String(ct.productId)] : undefined) ||
          ct?.productId,
        transportTypeId: d.transportTypeId || ct?.transportTypeId,
        transportTypeName:
          d.transportTypeName ||
          ct?.transportTypeName ||
          (ct?.transportTypeId ? htvtMap[String(ct.transportTypeId)] : undefined) ||
          ct?.transportTypeId,
        carrierId: (() => {
          const vid = String(d.vehicleId || ct?.vehicleId || "").trim();
          if (!vid) return undefined;
          return xeDvt[vid] || xeDvt[vid.toUpperCase()] || undefined;
        })(),
        carrierName: (() => {
          const vid = String(d.vehicleId || ct?.vehicleId || "").trim();
          const ma = vid
            ? xeDvt[vid] || xeDvt[vid.toUpperCase()] || ""
            : "";
          if (!ma) return undefined;
          return dvtMap[ma] || dvtMap[String(ma).toUpperCase()] || ma;
        })(),
        regionId: d.regionId || ct?.regionId,
        warehouse: d.warehouse || ct?.warehouse,
        detailStatus: status,
        actualReceived: ct?.actualReceived ?? d.actualReceived,
        receivedDate: ct?.receivedDate || d.receivedDate,
        isDuyenHa: !!(ct as { isDuyenHa?: boolean } | undefined)?.isDuyenHa || d.isDuyenHa,
        orderId: d.orderId || ct?.orderId || undefined,
        supplierId,
        // Hình thức gửi đơn (NCC) — map 1 lần từ nccSend, không gọi Sheet theo từng dòng
        sendMethod: d.sendMethod || resolveSend(supplierId) || "",
      };
    });

    // Loại xe đã xóa (CT.TrangThaiXe = Xóa xe / DELETE) — vẫn giữ Hủy xe
    rows = rows.filter((d) => {
      const st = String(d.detailStatus || "").trim().toUpperCase();
      if (!st) return true;
      if (st === "DELETE" || st === "XÓA XE" || st === "XOA XE") return false;
      if (st.includes("XÓA") || st.includes("XOA XE")) return false;
      return true;
    });

    // Lọc khoảng ngày (yyyy-MM-dd), inclusive — theo dateField
    const from = (fromDate || "").slice(0, 10);
    const to = (toDate || "").slice(0, 10);
    if (from || to) {
      rows = rows.filter((d) => {
        const raw =
          dateField === "delivery"
            ? String(d.deliveryDate || "").slice(0, 10)
            : String(d.orderDate || "").slice(0, 10);
        // Không có ngày tương ứng → không vào khoảng (tránh lẫn dữ liệu lệch mục tiêu)
        if (!raw || raw.length < 10) return false;
        if (from && raw < from) return false;
        if (to && raw > to) return false;
        return true;
      });
    }

    // regionName + đơn giá mua (export) — V21 resolveGiaLocal_ theo ngày nhận CT
    {
      const kvMap = await MasterRepository.kvNames().catch(
        () => ({} as Record<string, string>)
      );
      let gm: GiaMuaRow[] = [];
      if (withPrice) {
        try {
          const gmRows = await readSheetAsObjects(SHEETS.GM, {});
          gm = gmRows
            .map(mapGiaMuaSheetRow)
            .filter((r): r is GiaMuaRow => !!r);
        } catch {
          gm = [];
        }
      }
      rows = rows.map((d) => {
        const kv = String(d.regionId || "").trim();
        const next: Delivery = {
          ...d,
          regionName: kv ? kvMap[kv] || kvMap[kv.toUpperCase()] || kv : "",
        };
        if (withPrice) {
          // Chưa nhận → không gán giá (null) — đúng V21
          const rec = String(d.receivedDate || "").slice(0, 10);
          const r = rec
            ? resolveDonGiaMua(gm, d.supplierId || "", d.productId || "", kv, rec)
            : null;
          next.unitPrice = r && r.found ? r.donGia : null;
        }
        return next;
      });
    }

    // PDF FileDonhang theo MaDon
    try {
      const { OrderRepository } = await import("@/repositories/order.repository");
      const year = filter.year ?? currentYearVN();
      const orders = await OrderRepository.findMany({ year });
      const fileByOrder = new Map(
        orders
          .filter((o) => o.orderId && o.orderFile)
          .map((o) => [String(o.orderId).trim(), String(o.orderFile)])
      );
      rows = rows.map((d) => ({
        ...d,
        orderFile: d.orderFile || (d.orderId ? fileByOrder.get(String(d.orderId).trim()) : undefined),
      }));
    } catch {
      /* ignore */
    }
    // Debug: thiếu status → chip lọc sẽ không khớp
    const missingSt = rows.filter((r) => !r.detailStatus).length;
    if (missingSt > 0) {
      console.warn(
        `[DeliveryService] ${missingSt}/${rows.length} GH thiếu detailStatus (CT join miss)`
      );
    }
    // UI: Sort mới → cũ theo ngày đặt lệnh. Export (V21): ngày TĂNG dần → mã xe → mã chi tiết.
    if (sortAsc) {
      rows.sort((a, b) => {
        const da = String(a.orderDate || a.deliveryDate || "").slice(0, 10);
        const db = String(b.orderDate || b.deliveryDate || "").slice(0, 10);
        if (da !== db) return da.localeCompare(db);
        const va = String(a.vehicleId || "").toLowerCase();
        const vb = String(b.vehicleId || "").toLowerCase();
        if (va !== vb) return va.localeCompare(vb);
        return String(a.detailId || "").localeCompare(String(b.detailId || ""));
      });
    } else {
      rows.sort((a, b) => {
        const da = a.orderDate || a.deliveryDate || "";
        const db = b.orderDate || b.deliveryDate || "";
        if (da !== db) return db.localeCompare(da);
        return (b.deliveryId || "").localeCompare(a.deliveryId || "");
      });
    }

    if (filter.all) {
      return {
        items: rows,
        page: 1,
        pageSize: rows.length,
        total: rows.length,
        hasMore: false,
      };
    }
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filter.pageSize ?? 100));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }


  /**
   * Xuất Excel — V21 getDeliveries(email, {fromDate,toDate,export:true}):
   * không phân trang, mặc định 30 ngày, GH active + CT Hủy chưa có GH, tăng dần, có đơn giá.
   */
  static async exportDeliveries(
    filter: {
      fromDate?: string;
      toDate?: string;
      dateField?: "order" | "delivery";
    },
    user: UserContext,
    scope: AccessScope
  ) {
    let from = String(filter.fromDate || "").slice(0, 10);
    let to = String(filter.toDate || "").slice(0, 10);
    const dateField: "order" | "delivery" =
      filter.dateField === "delivery" ? "delivery" : "order";
    if (!from && !to) {
      const r = defaultListDateRange(30);
      from = r.from;
      to = r.to;
    }
    const y1 = Number((from || to).slice(0, 4)) || currentYearVN();
    const y2 = Number((to || from).slice(0, 4)) || y1;
    const items: Delivery[] = [];
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      const r = await DeliveryService.listDeliveries(
        {
          year: y,
          fromDate: from,
          toDate: to,
          dateField,
          all: true,
          includeCancelNoGh: true,
          withPrice: true,
          sortAsc: true,
        },
        user,
        scope
      );
      items.push(...r.items);
    }
    items.sort((a, b) => {
      const da = String(
        dateField === "delivery" ? a.deliveryDate || a.orderDate : a.orderDate || a.deliveryDate || ""
      ).slice(0, 10);
      const db = String(
        dateField === "delivery" ? b.deliveryDate || b.orderDate : b.orderDate || b.deliveryDate || ""
      ).slice(0, 10);
      if (da !== db) return da.localeCompare(db);
      const va = String(a.vehicleId || "").toLowerCase();
      const vb = String(b.vehicleId || "").toLowerCase();
      if (va !== vb) return va.localeCompare(vb);
      return String(a.detailId || "").localeCompare(String(b.detailId || ""));
    });
    return { items, total: items.length, from, to, dateField };
  }

  /**
   * Cập nhật thực giao — V21 saveDeliveryData (1 dòng)
   * Rules: D4 ngày nhận, D5 ngày giao, D6 chia hết, D7 hao hụt (needConfirm)
   */
  static async updateDelivery(
    deliveryId: string,
    payload: {
      actualQty: number;
      deliveryDate?: string;
      note?: string;
      customerId?: string;
      customerDetail?: string;
      /** Client xác nhận vượt ngưỡng hao hụt */
      confirm?: boolean;
    },
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "DELIVERY_UPDATE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền cập nhật giao hàng" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }

    const qty = qty3(Number(payload.actualQty));
    if (qty < 0) {
      throw { code: "VALIDATION_ERROR", message: "Thực giao không hợp lệ" };
    }
    const ngay = (payload.deliveryDate || todayYmdVN()).slice(0, 10);
    const y = year ?? currentYearVN();

    // Load GH hiện tại
    const allGh = await DeliveryRepository.findMany({ year: y, includeDeleted: false });
    const current = allGh.find((g) => g.deliveryId === deliveryId);
    if (!current) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy GH " + deliveryId };
    }
    if (current.deleted) {
      throw { code: "VALIDATION_ERROR", message: "Dòng giao đã xóa, không thể cập nhật." };
    }
    const detailId = current.detailId;

    // Load CT
    let ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      // Retry: parse năm từ mã CT
      const parsed = DetailRepository.yearFromDetailId(detailId);
      if (parsed && parsed !== y) {
        ct = await DetailRepository.findById(detailId, parsed);
      }
    }
    if (!ct) {
      throw {
        code: "NOT_FOUND",
        message:
          `Không tìm thấy chi tiết ${detailId} (year=${y}). ` +
          `Kiểm tra ID_Chitiet trên sheet và năm đơn.`,
      };
    }
    const st = String(ct.status || "");
    if (["Xóa xe", "DELETE"].includes(st) || st.toUpperCase() === "DELETE") {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chi tiết đã xóa khỏi đơn, không được lưu giao hàng.",
      };
    }

    // P0: Data Scope trên bản ghi GH / CT / KH
    {
      const scope = resolveScope(user);
      if (scope.scopeType !== "ALL") {
        const khAllowed = await resolveAllowedCustomerIds(scope);
        const targetKh = String(
          payload.customerId || current.customerId || ""
        ).trim();
        if (khAllowed) {
          if (
            targetKh &&
            !khAllowed.has(targetKh) &&
            !khAllowed.has(targetKh.toUpperCase())
          ) {
            throw {
              code: "PERMISSION_DENIED",
              message: "Khách hàng ngoài phạm vi quản lý — không được cập nhật GH.",
            };
          }
        }
        const nccAllowed = await resolveAllowedSupplierIds(scope);
        const sid = String(ct.supplierId || "").trim();
        if (nccAllowed) {
          if (
            sid &&
            !nccAllowed.has(sid) &&
            !nccAllowed.has(sid.toUpperCase())
          ) {
            throw {
              code: "PERMISSION_DENIED",
              message: "NCC ngoài phạm vi quản lý — không được cập nhật GH.",
            };
          }
        }
        // OWNER-only: chỉ đơn do mình tạo
        if (
          (scope.scopeType === "OWNER" || !!scope.allowOwner) &&
          !scope.allowManagement &&
          scope.scopeType !== "UNION"
        ) {
          const { OrderRepository } = await import(
            "@/repositories/order.repository"
          );
          const order = await OrderRepository.findById(ct.orderId, y).catch(
            () => null
          );
          const em = String(scope.ownerEmail || user.email || "")
            .toLowerCase()
            .trim();
          const by = String(order?.createdBy || "")
            .toLowerCase()
            .trim();
          if (em && by && by !== em) {
            throw {
              code: "PERMISSION_DENIED",
              message: "Chỉ thao tác giao hàng trên đơn do mình tạo.",
            };
          }
        }
      }
    }

    // HH: chia hết + hao hụt
    let tyleChiahet = 0;
    let tyleHaohut = 0;
    let tenHH = ct.productName || ct.productId || "";
    try {
      const hhRows = await readSheetAsObjects(SHEETS.HH, {});
      const pid = String(ct.productId || "").trim().toUpperCase();
      const hh = hhRows.find(
        (r) => String(r.MaHH || r.MaHh || "").trim().toUpperCase() === pid
      );
      if (hh) {
        tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
        tyleHaohut = Number(hh.TyleHaohut || hh.TyleHaoHut || 0) || 0;
        tenHH = String(hh.TenHangHoa || tenHH);
      }
    } catch {
      /* optional */
    }

    // D5–D6: khi TG > 0
    if (qty > 0) {
      const dateCheck = validateDeliveryDate({
        receivedDate: ct.receivedDate,
        deliveryDate: ngay,
        isDuyenHa: !!ct.isDuyenHa,
        detailId,
      });
      if (!dateCheck.ok) {
        throw { code: "VALIDATION_ERROR", message: dateCheck.error };
      }
      if (!validateStep(qty, tyleChiahet)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Thực giao cho sản phẩm ${tenHH} phải chia hết cho ${tyleChiahet} tấn. Hiện tại: ${qty.toFixed(2)} tấn.`,
        };
      }
    }

    // Khách ảo (VIRTUAL / acghang*) không được thực giao > 0 (parity saveReal / GAS)
    if (qty > 0) {
      const targetKh = String(payload.customerId || current.customerId || "").trim();
      const virtualKh = await loadVirtualCustomerSet();
      if (isVirtualCustomerId(targetKh, virtualKh)) {
        throw { code: "VALIDATION_ERROR", message: VIRTUAL_CUSTOMER_REAL_MSG };
      }
    }

    // D7: tổng TG sau update vs ThucNhan
    const thucNhan = qty3(Number(ct.actualReceived) || 0);
    const othersTg = allGh
      .filter((g) => !g.deleted && g.detailId === detailId && g.deliveryId !== deliveryId)
      .reduce((s, g) => s + (Number(g.actualQty) || 0), 0);
    const totalTgAfter = qty3(othersTg + qty);
    const tl = normalizeHaohut(tyleHaohut);

    if (thucNhan > 0 && totalTgAfter > thucNhan + 1e-6) {
      const overRatio = (totalTgAfter - thucNhan) / thucNhan;
      if (overRatio > tl + 1e-9) {
        const isAdmin = hasPermission(user, "*") || String(user.role).toUpperCase() === "ADMIN";
        if (!payload.confirm) {
          throw {
            code: "NEED_CONFIRM",
            message:
              `Tổng thực giao (${totalTgAfter.toFixed(2)}) vượt thực nhận (${thucNhan.toFixed(2)}) ` +
              `${(overRatio * 100).toFixed(1)}%, vượt ngưỡng cho phép ${(tl * 100).toFixed(0)}%.` +
              (isAdmin
                ? " Bạn xác nhận lưu với vai trò Admin?"
                : " Vui lòng liên hệ admin hoặc giảm số lượng."),
            needConfirm: isAdmin,
            meta: { totalTgAfter, thucNhan, overRatio, tlHH: tl },
          };
        }
        if (!isAdmin) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Tổng thực giao vượt ngưỡng hao hụt ${(tl * 100).toFixed(0)}%. Không có quyền ghi đè.`,
          };
        }
      } else if (!payload.confirm) {
        // trong ngưỡng — vẫn hỏi xác nhận (V21 soft confirm)
        throw {
          code: "NEED_CONFIRM",
          message:
            `Tổng thực giao (${totalTgAfter.toFixed(2)}) vượt thực nhận (${thucNhan.toFixed(2)}) ` +
            `${(overRatio * 100).toFixed(1)}%, trong ngưỡng cho phép ${(tl * 100).toFixed(0)}%. Bạn xác nhận lưu?`,
          needConfirm: true,
          meta: { totalTgAfter, thucNhan, overRatio, tlHH: tl },
        };
      }
    }

    const patch: Record<string, string | number | boolean> = {
      ThucGiao: qty,
      Ngaygiao: ngay,
    };
    if (payload.note !== undefined) patch.Ghichu = payload.note;
    if (payload.customerId) {
      // acghang → B/R theo HH của CT (nếu đã load meta); fallback giữ nguyên
      let pl = "";
      try {
        const hhRows = await readSheetAsObjects(SHEETS.HH, {});
        const pid = String(ct.productId || "").trim().toUpperCase();
        const hh = hhRows.find(
          (r) => String(r.MaHH || r.MaHh || "").trim().toUpperCase() === pid
        );
        if (hh) pl = String(hh.PhanLoaiHH || hh.PhanLoai || "");
      } catch { /* optional */ }
      patch.MaKh = resolveAcghangOnSave(payload.customerId, pl);
    }
    if (payload.customerDetail !== undefined) patch.ChitietKh = payload.customerDetail;

    const row = await updateSheetRowByKey(
      SHEETS.GH,
      "ID_Giaohang",
      deliveryId,
      patch,
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy GH " + deliveryId };

    // Sync TrangThaiXe CT
    const newStatus = computeDetailStatus({
      currentStatus: st,
      thucNhan,
      totalThucGiao: totalTgAfter,
      tlHaohut: tyleHaohut,
    });
    if (newStatus && newStatus !== st) {
      try {
        await updateSheetRowByKey(
          SHEETS.CT,
          "ID_Chitiet",
          detailId,
          {
            TrangThaiXe: newStatus,
            TimeChange: formatDateTimeVN(),
          },
          y
        );
      } catch (e) {
        console.error("[updateDelivery] sync CT status", e);
      }
    }

    await syncOrderStatusByDetailId(detailId, y).catch(() => null);

    
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "SAVE_DELIVERY",
      idGh: deliveryId,
      targetId: deliveryId,
      newValue: JSON.stringify({
        actualQty: payload.actualQty,
        deliveryDate: payload.deliveryDate,
        customerId: payload.customerId,
      }),
      year: year ?? new Date().getFullYear(),
    }).catch(() => {});

    return {
      deliveryId,
      detailId,
      actualQty: qty,
      deliveryDate: ngay,
      totalThucGiao: totalTgAfter,
      thucNhan,
      detailStatus: newStatus,
      row,
    };
  }


  /**
   * Lưu kế hoạch giao (Sửa KH) — V21 saveDeliveryData mode plan
   * rows: { deliveryId?, customerId, customerDetail?, plannedQty, note?, _delete? }
   * - cập nhật / append GH
   * - soft-delete dòng không còn trong list (hoặc _delete)
   * - sync SoLuong CT = SUM(KHgiao active)
   */
  static async savePlan(
    detailId: string,
    rows: Array<{
      deliveryId?: string;
      customerId: string;
      customerDetail?: string;
      plannedQty: number;
      note?: string;
      _delete?: boolean;
    }>,
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "DELIVERY_UPDATE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền sửa kế hoạch giao" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const y = year ?? currentYearVN();
    // TyleChiahet từ HH của chi tiết — parity V21 saveDeliveryData plan
    let tyleChiahet = 0;
    let phanLoaiHH = "";
    let tenHH = detailId;
    let orderIdForAudit = "";
    /** Ngày đặt CT — dùng cấp mã GH (không dùng ngày lưu / ngày giao) */
    let orderDateForId = "";
    let oldSoLuong = 0;
    let oldStatus: string = "";
    let thucNhan = 0;
    try {
      const ct = await DetailRepository.findById(detailId, y);
      orderIdForAudit = ct?.orderId || "";
      orderDateForId =
        ymdDate(ct?.orderDate) || String(ct?.orderDate || "").slice(0, 10) || "";
      oldSoLuong = Number(ct?.quantity) || 0;
      oldStatus = String(ct?.status || "");
      thucNhan = Number(ct?.actualReceived) || 0;
      if (ct?.productId) {
        const hhRows = await readSheetAsObjects(SHEETS.HH, {});
        const hh = hhRows.find(
          (r) => String(r.MaHH || "").trim() === String(ct.productId).trim()
        );
        if (hh) {
          tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
          phanLoaiHH = String(hh.PhanLoaiHH || hh.PhanLoai || hh.phanLoai || "");
          tenHH = String(hh.TenHangHoa || ct.productId);
        }
      }
    } catch {
      /* optional */
    }

    await assertOrderInScope(
      orderIdForAudit,
      user,
      y,
      "Chi tiết thuộc đơn ngoài phạm vi — không được sửa kế hoạch giao."
    );

    const existing = await DeliveryRepository.findMany({
      year: y,
      detailId,
      includeDeleted: false,
    });
    const existingIds = new Set(existing.map((e) => e.deliveryId));
    const keepIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let deleted = 0;

    const now = new Date();

    for (const r of rows) {
      if (r._delete && r.deliveryId) {
        const row = await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          r.deliveryId,
          {
            Deleted: true,
            DeletedAt: formatDateTimeVN(now),
            DeletedBy: user.email,
          },
          y
        );
        if (row > 0) deleted++;
        continue;
      }
      const maKh = resolveAcghangOnSave(
        String(r.customerId || "").trim(),
        phanLoaiHH
      );
      const khg = qty3(Number(r.plannedQty) || 0);
      if (!maKh) {
        throw { code: "VALIDATION_ERROR", message: "Thiếu mã khách hàng" };
      }
      if (!(khg > 0)) {
        throw { code: "VALIDATION_ERROR", message: "KH giao phải > 0" };
      }
      if (!validateStep(khg, tyleChiahet)) {
        throw {
          code: "VALIDATION_ERROR",
          message: `Kế hoạch giao cho ${tenHH} phải chia hết cho ${tyleChiahet} tấn. Giá trị hiện tại: ${khg} tấn.`,
        };
      }
      if (r.deliveryId && !isTempClientId(r.deliveryId) && existingIds.has(r.deliveryId)) {
        await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          r.deliveryId,
          {
            MaKh: maKh,
            ChitietKh: r.customerDetail || "",
            KHgiao: khg,
            Ghichu: r.note || "",
          },
          y
        );
        keepIds.add(r.deliveryId);
        updated++;
      } else {
        // Cấp mã GH theo ngày đặt CT (không theo ngày lưu / ngày giao)
        const idGh = await newDeliveryId(
          orderDateForId || ymdDate(new Date()) || undefined,
          {
            email: user.email,
            year: y,
          }
        );
        await appendSheetRow(
          SHEETS.GH,
          {
            ID_Giaohang: idGh,
            ID_Chitiet: detailId,
            MaKh: maKh,
            ChitietKh: r.customerDetail || "",
            KHgiao: khg,
            ThucGiao: 0,
            Ngaygiao: "",
            Ghichu: r.note || "",
            Deleted: false,
            DeletedAt: "",
            DeletedBy: "",
          },
          y
        );
        keepIds.add(idGh);
        created++;
      }
    }

    // Soft-delete existing not in keepIds (khi client gửi full list)
    for (const e of existing) {
      if (!keepIds.has(e.deliveryId) && !rows.some((r) => r._delete && r.deliveryId === e.deliveryId)) {
        // only auto-delete if client sent at least one keep row or empty intentional
        // Skip auto-delete if rows empty? safer: auto-delete orphans when full replace
        if (rows.length > 0 && !rows.some((r) => r.deliveryId === e.deliveryId || r._delete)) {
          const row = await updateSheetRowByKey(
            SHEETS.GH,
            "ID_Giaohang",
            e.deliveryId,
            {
              Deleted: true,
              DeletedAt: formatDateTimeVN(now),
              DeletedBy: user.email,
            },
            y
          );
          if (row > 0) deleted++;
        }
      }
    }

    // Sync SoLuong CT
    const after = await DeliveryRepository.findMany({
      year: y,
      detailId,
      includeDeleted: false,
    });
    const sumKh = qty3(after.reduce((s, g) => s + (Number(g.plannedQty) || 0), 0));
    await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      { SoLuong: sumKh, TimeChange: formatDateTimeVN(now), User: user.email },
      y
    );

    // V21: planMode + ThucNhan<=0 + status NEW|ORDERED + đổi SoLuong → GuiLaimail
    let resendMarked = false;
    let changedFields: string[] = [];
    const st = oldStatus.toUpperCase();
    const canMarkPlanResend =
      thucNhan <= 0 &&
      (st === "NEW" ||
        st === "ORDERED" ||
        st === "MỚI TẠO" ||
        st === "ĐẶT HÀNG" ||
        oldStatus === STATUS_CT.NEW ||
        oldStatus === STATUS_CT.ORDERED) &&
      !numClose(oldSoLuong, sumKh);

    if (canMarkPlanResend && orderIdForAudit) {
      const order = await OrderRepository.findById(orderIdForAudit, y);
      const mark = await markOrderResendIfSent({
        orderId: orderIdForAudit,
        order,
        email: user.email,
        role: user.role,
        action: "PLAN_QTY_CHANGED_REQUIRE_RESEND",
        changedFields: ["Số lượng kế hoạch"],
        oldValue: { SoLuong: oldSoLuong },
        newValue: { SoLuong: sumKh },
        year: y,
      });
      resendMarked = mark.marked;
      changedFields = mark.changedFields;
    }

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "SAVE_PLAN",
      maDon: orderIdForAudit,
      idCt: detailId,
      targetId: detailId,
      newValue: { soLuong: sumKh, created, updated, deleted },
      lyDo: resendMarked
        ? "Lưu kế hoạch giao, thay đổi số lượng kế hoạch nên bật GuiLaimail"
        : "Lưu kế hoạch giao (KHgiao)",
      year: y,
    });

    return {
      detailId,
      soLuong: sumKh,
      created,
      updated,
      deleted,
      rows: after.length,
      resendMarked,
      changedFields,
    };
  }

  /**
   * Lưu thực giao (batch) — parity V21 saveDeliveryData realMode
   * - validate chia hết TyleChiahet
   * - TG < TN → NEED_CONFIRM + tồn còn lại
   * - TG ≠ KHgiao (vượt ngưỡng hao hụt) → điều chỉnh KHgiao, đẩy phần dư sang dòng pending
   * - sync TrangThaiXe CT
   */
  static async saveReal(
    detailId: string,
    rows: Array<{
      deliveryId?: string;
      customerId: string;
      customerDetail?: string;
      plannedQty?: number;
      actualQty?: number;
      deliveryDate?: string;
      note?: string;
    }>,
    options: { confirmFinish?: boolean; adminOverride?: boolean } | undefined,
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "DELIVERY_UPDATE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền lưu giao hàng" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const y = year ?? currentYearVN();
    const opts = options || {};
    const isAdmin =
      hasPermission(user, "*") || String(user.role).toUpperCase() === "ADMIN";

    let ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      // Retry: parse năm từ mã CT
      const parsed = DetailRepository.yearFromDetailId(detailId);
      if (parsed && parsed !== y) {
        ct = await DetailRepository.findById(detailId, parsed);
      }
    }
    if (!ct) {
      throw {
        code: "NOT_FOUND",
        message:
          `Không tìm thấy chi tiết ${detailId} (year=${y}). ` +
          `Kiểm tra ID_Chitiet trên sheet và năm đơn.`,
      };
    }
    const st = String(ct.status || "");
    const stUp = st.toUpperCase();
    if (
      ["Xóa xe", "DELETE", "Hủy xe", "CANCEL", "Hoàn thành", "DONE"].includes(st) ||
      ["DELETE", "CANCEL", "DONE"].includes(stUp)
    ) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chi tiết đã hoàn thành hoặc đã hủy/xóa, không được lưu giao hàng.",
      };
    }

    await assertOrderInScope(
      ct.orderId,
      user,
      y,
      "Chi tiết thuộc đơn ngoài phạm vi — không được lưu giao hàng."
    );

    const thucNhan = qty3(Number(ct.actualReceived) || 0);
    if (!(thucNhan > 0)) {
      throw {
        code: "VALIDATION_ERROR",
        message:
          `Chi tiết ${detailId} chưa có số lượng thực nhận (ThucNhan=${ct.actualReceived ?? "trống"}). ` +
          `Hãy nhận hàng trước khi giao.`,
      };
    }

    // HH meta
    let tyleChiahet = 0;
    let tyleHaohut = 0;
    let phanLoaiHH = "";
    let tenHH = ct.productName || ct.productId || "";
    try {
      const hhRows = await readSheetAsObjects(SHEETS.HH, {});
      const pid = String(ct.productId || "").trim().toUpperCase();
      const hh = hhRows.find(
        (r) => String(r.MaHH || r.MaHh || "").trim().toUpperCase() === pid
      );
      if (hh) {
        tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
        tyleHaohut = Number(hh.TyleHaohut || hh.TyleHaoHut || 0) || 0;
        phanLoaiHH = String(hh.PhanLoaiHH || hh.PhanLoai || hh.phanLoai || "");
        tenHH = String(hh.TenHangHoa || tenHH);
      }
    } catch {
      /* optional */
    }
    const tlHH = normalizeHaohut(tyleHaohut);

    const roundStep = (v: number) => {
      if (tyleChiahet > EPS) return qty3(Math.round(v / tyleChiahet) * tyleChiahet);
      return qty3(v);
    };

    // Working list
    type RowW = {
      deliveryId: string;
      customerId: string;
      customerDetail: string;
      plannedQty: number;
      actualQty: number;
      deliveryDate: string;
      note: string;
      isNew: boolean;
    };
    const list: RowW[] = (rows || []).map((r) => {
      const id = String(r.deliveryId || "").trim();
      const isNew = !id || isTempClientId(id) || id.startsWith("NEW-");
      return {
        deliveryId: id,
        customerId: String(r.customerId || "").trim(),
        customerDetail: String(r.customerDetail || "").trim(),
        plannedQty: qty3(Number(r.plannedQty) || 0),
        actualQty: qty3(Number(r.actualQty) || 0),
        deliveryDate: String(r.deliveryDate || "").slice(0, 10),
        note: String(r.note || "").trim(),
        isNew,
      };
    });

    if (!list.length) {
      throw { code: "VALIDATION_ERROR", message: "Phải có ít nhất 1 dòng giao hàng." };
    }

    // Khách ảo: LoaiKhach=VIRTUAL (DM_KhachHang) hoặc khách đệm acghang/acghangB/acghangR
    const virtualKh = await loadVirtualCustomerSet();

    // Validate từng dòng TG > 0
    for (const item of list) {
      if (!item.customerId) {
        throw { code: "VALIDATION_ERROR", message: "Dòng giao hàng thiếu khách hàng." };
      }
      if (item.actualQty > 0 && isVirtualCustomerId(item.customerId, virtualKh)) {
        throw { code: "VALIDATION_ERROR", message: VIRTUAL_CUSTOMER_REAL_MSG };
      }
      if (item.actualQty > 0) {
        const dateCheck = validateDeliveryDate({
          receivedDate: ct.receivedDate,
          deliveryDate: item.deliveryDate || todayYmdVN(),
          isDuyenHa: !!ct.isDuyenHa,
          detailId,
        });
        if (!dateCheck.ok) {
          throw { code: "VALIDATION_ERROR", message: dateCheck.error };
        }
        if (!validateStep(item.actualQty, tyleChiahet)) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Thực giao cho sản phẩm ${tenHH} phải chia hết cho ${tyleChiahet} tấn. Dòng giao cho khách ${item.customerId} hiện tại: ${item.actualQty.toFixed(2)} tấn.`,
          };
        }
      }
    }

    const existing = await DeliveryRepository.findMany({
      year: y,
      detailId,
      includeDeleted: false,
    });
    const existingById = new Map(existing.map((e) => [e.deliveryId, e]));

    // Tìm dòng đang thay đổi (delta |TG − KHgiao cũ| lớn nhất)
    let changed: RowW | null = null;
    let oldKhGiao = 0;
    let maxDelta = 0;
    for (const item of list) {
      if (!(item.actualQty > 0)) continue;
      let oldKh = item.plannedQty;
      if (!item.isNew && existingById.has(item.deliveryId)) {
        oldKh = qty3(Number(existingById.get(item.deliveryId)!.plannedQty) || 0);
      }
      const delta = Math.abs(item.actualQty - oldKh);
      if (delta > 0.0001 && delta > maxDelta) {
        maxDelta = delta;
        changed = item;
        oldKhGiao = oldKh;
      }
    }

    const delivered = list.filter((x) => x.actualQty > 0);
    const totalThucGiaoAfter = qty3(
      delivered.reduce((s, x) => s + x.actualQty, 0)
    );

    // V21: TG < TN → hỏi xác nhận + tồn còn lại
    if (totalThucGiaoAfter + 1e-6 < thucNhan && !opts.confirmFinish) {
      const ton = qty3(thucNhan - totalThucGiaoAfter);
      throw {
        code: "NEED_CONFIRM",
        message:
          `Tổng thực giao (${totalThucGiaoAfter.toFixed(2)}) nhỏ hơn thực nhận (${thucNhan.toFixed(2)}).\n` +
          `Tồn còn lại: ${ton.toFixed(2)}\n` +
          `Bạn vẫn muốn lưu?`,
        needConfirm: true,
        meta: {
          totalTgAfter: totalThucGiaoAfter,
          thucNhan,
          remaining: ton,
        },
      };
    }

    // V21: TG > TN
    if (totalThucGiaoAfter > thucNhan + 1e-6) {
      const overRatio = (totalThucGiaoAfter - thucNhan) / thucNhan;
      if (overRatio > tlHH + 1e-9) {
        if (!isAdmin) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Tổng thực giao vượt thực nhận ${(overRatio * 100).toFixed(1)}%, vượt ngưỡng cho phép ${(tlHH * 100).toFixed(0)}%. Vui lòng liên hệ admin.`,
          };
        }
        if (!opts.adminOverride && !opts.confirmFinish) {
          throw {
            code: "NEED_CONFIRM",
            message: `Tổng thực giao vượt ngưỡng ${(tlHH * 100).toFixed(0)}% cho phép (hiện tại vượt ${(overRatio * 100).toFixed(1)}%).\nBạn xác nhận lưu với vai trò Admin?`,
            needConfirm: true,
            meta: { totalTgAfter: totalThucGiaoAfter, thucNhan, overRatio, tlHH },
          };
        }
      } else if (!opts.confirmFinish) {
        throw {
          code: "NEED_CONFIRM",
          message:
            `Tổng thực giao (${totalThucGiaoAfter.toFixed(2)}) vượt thực nhận (${thucNhan.toFixed(2)}) ` +
            `${(overRatio * 100).toFixed(1)}%, trong ngưỡng cho phép ${(tlHH * 100).toFixed(0)}%.\nBạn xác nhận lưu?`,
          needConfirm: true,
          meta: { totalTgAfter: totalThucGiaoAfter, thucNhan, overRatio, tlHH },
        };
      }
    }

    // Điều chỉnh KHgiao khi TG ≠ KHgiao cũ (V21 under/over per-line)
    if (changed) {
      const newThuc = changed.actualQty;
      const delta = qty3(newThuc - oldKhGiao);
      const perLineRatio = Math.abs(delta) / thucNhan;
      const isSmall = perLineRatio <= tlHH + 1e-9;

      const pullFromPending = (amount: number): number => {
        let remaining = amount;
        let pulled = 0;
        // 1. buffer acghang / acghangB / acghangR (ưu tiên khớp phân loại HH)
        const preferId = defaultPlanKhFromPhanLoai(phanLoaiHH).id.toLowerCase();
        const buffers = list.filter((x) => isAcghangBufferKh(x.customerId));
        buffers.sort((a, b) => {
          const aa = String(a.customerId || "").toLowerCase() === preferId ? 0 : 1;
          const bb = String(b.customerId || "").toLowerCase() === preferId ? 0 : 1;
          return aa - bb;
        });
        for (const acg of buffers) {
          if (remaining <= 0.0001) break;
          const avail = acg.plannedQty;
          if (avail > 0) {
            const take = Math.min(avail, remaining);
            const newKh = Math.max(0, roundStep(avail - take));
            const actuallyTaken = qty3(avail - newKh);
            acg.plannedQty = newKh;
            pulled += actuallyTaken;
            remaining -= actuallyTaken;
          }
        }
        // 2. pending khác (TG=0, không phải buffer)
        if (remaining > 0.0001) {
          for (const p of list) {
            if (remaining <= 0.0001) break;
            if (p.actualQty > 0) continue;
            if (isAcghangBufferKh(p.customerId)) continue;
            const avail = p.plannedQty;
            if (avail <= 0) continue;
            const take = Math.min(avail, remaining);
            const newKh = Math.max(0, roundStep(avail - take));
            const actuallyTaken = qty3(avail - newKh);
            p.plannedQty = newKh;
            pulled += actuallyTaken;
            remaining -= actuallyTaken;
          }
        }
        return qty3(pulled);
      };

      const pushToPending = (amount: number) => {
        if (amount <= 0.0001) return;
        const prefer = defaultPlanKhFromPhanLoai(phanLoaiHH);
        const acg =
          list.find(
            (x) =>
              String(x.customerId || "").toLowerCase() ===
              prefer.id.toLowerCase()
          ) || list.find((x) => isAcghangBufferKh(x.customerId));
        if (acg) {
          acg.plannedQty = roundStep(acg.plannedQty + amount);
          return;
        }
        const pending = list.filter(
          (item) => item.actualQty === 0 && !isAcghangBufferKh(item.customerId)
        );
        if (pending.length > 0) {
          pending[0].plannedQty = roundStep(pending[0].plannedQty + amount);
          return;
        }
        // Tạo dòng buffer theo phân loại HH (Bao→B, Rời→R)
        list.push({
          deliveryId: `NEW-acg-${Date.now()}`,
          customerId: prefer.id,
          customerDetail: "",
          plannedQty: roundStep(amount),
          actualQty: 0,
          deliveryDate: "",
          note: "Điều chỉnh kế hoạch",
          isNew: true,
        });
      };

      if (delta > 0) {
        // over: TG > KHgiao cũ → rút từ pending
        if (!isSmall || totalThucGiaoAfter >= thucNhan - 0.0001) {
          const pulled = pullFromPending(delta);
          changed.plannedQty = roundStep(oldKhGiao + pulled);
        }
      } else if (delta < -0.0001) {
        // under: TG < KHgiao cũ
        const freed = qty3(oldKhGiao - newThuc);
        if (!isSmall) {
          changed.plannedQty = roundStep(newThuc);
          pushToPending(freed);
        }
        // isSmall: giữ KHgiao, không điều chỉnh (V21)
      }
    }

    // Ghi sheet
    let updated = 0;
    let created = 0;
    for (const item of list) {
      const thucGiao = item.actualQty;
      const khGiao = item.plannedQty;
      const ngay =
        thucGiao > 0 ? item.deliveryDate || todayYmdVN() : "";
      const maKhResolved = resolveAcghangOnSave(item.customerId, phanLoaiHH);

      if (!item.isNew && existingById.has(item.deliveryId)) {
        await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          item.deliveryId,
          {
            MaKh: maKhResolved,
            ChitietKh: item.customerDetail || "",
            KHgiao: khGiao,
            ThucGiao: thucGiao,
            Ngaygiao: ngay,
            Ghichu: item.note || "",
            Deleted: false,
          },
          y
        );
        updated++;
      } else {
        // chỉ tạo mới nếu có KHgiao hoặc TG
        if (!(khGiao > 0 || thucGiao > 0)) continue;
        // Cấp mã GH theo ngày đặt CT (không theo ngày giao / ngày lưu)
        const orderDateKey =
          ymdDate(ct.orderDate) ||
          String(ct.orderDate || "").slice(0, 10) ||
          ymdDate(new Date()) ||
          undefined;
        const idGh = await newDeliveryId(orderDateKey, {
          email: user.email,
          year: y,
        });
        await appendSheetRow(
          SHEETS.GH,
          {
            ID_Giaohang: idGh,
            ID_Chitiet: detailId,
            MaKh: maKhResolved,
            ChitietKh: item.customerDetail || "",
            KHgiao: khGiao,
            ThucGiao: thucGiao,
            Ngaygiao: ngay,
            Ghichu: item.note || "",
            Deleted: false,
            DeletedAt: "",
            DeletedBy: "",
          },
          y
        );
        created++;
      }
    }

    // Sync status CT
    const totalTg = qty3(
      list.reduce((s, x) => s + (Number(x.actualQty) || 0), 0)
    );
    const sumKh = qty3(
      list.reduce((s, x) => s + (Number(x.plannedQty) || 0), 0)
    );
    const newStatus = computeDetailStatus({
      currentStatus: st,
      thucNhan,
      totalThucGiao: totalTg,
      tlHaohut: tyleHaohut,
    });
    try {
      await updateSheetRowByKey(
        SHEETS.CT,
        "ID_Chitiet",
        detailId,
        {
          SoLuong: sumKh,
          ...(newStatus ? { TrangThaiXe: newStatus } : {}),
          TimeChange: formatDateTimeVN(),
          User: user.email,
        },
        y
      );
    } catch (e) {
      console.error("[saveReal] sync CT", e);
    }
    await syncOrderStatusByDetailId(detailId, y).catch(() => null);

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "SAVE_DELIVERY",
      maDon: ct.orderId,
      idCt: detailId,
      targetId: detailId,
      newValue: {
        count: list.length,
        totalTg,
        thucNhan,
        sumKh,
        updated,
        created,
      },
      lyDo: "Lưu thực giao batch (saveReal)",
      year: y,
    }).catch(() => {});

    return {
      detailId,
      totalThucGiao: totalTg,
      thucNhan,
      soLuong: sumKh,
      detailStatus: newStatus,
      updated,
      created,
    };
  }
}
