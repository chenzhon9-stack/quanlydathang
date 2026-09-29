import { writeAudit } from "@/lib/sheets/audit";
import type { AccessScope, Delivery, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterByCustomerIds,
  resolveAllowedCustomerIds,
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
import { isSheetsConfigured } from "@/lib/sheets/client";
import { todayYmdVN, STATUS_CT } from "@/lib/status";
import { DetailRepository } from "@/repositories/detail.repository";
import { syncOrderStatusByDetailId } from "@/lib/sync-order-status";
import { newDeliveryId, isTempClientId } from "@/lib/sheets/counter";
import {ymdDate, formatDateTimeVN, currentYearVN} from "@/lib/sheets/date";

export class DeliveryService {
  static async listDeliveries(
    filter: {
      year?: number;
      fromDate?: string;
      toDate?: string;
      detailId?: string;
      customerId?: string;
      page?: number;
      pageSize?: number;
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

    let rows = await DeliveryRepository.findMany(filter);

    // MANAGEMENT / SALES: lọc theo KH.Quanly ∩ User.Quanly (V21)
    if (scope.scopeType === "MANAGEMENT" || scope.scopeType === "OWN_CUSTOMER") {
      const allowed = await resolveAllowedCustomerIds(scope);
      rows = filterByCustomerIds(rows, allowed);
    }

    // Enrich tên KH + orderDate/xe/hàng từ CT (gom theo ngày đặt lệnh)
    const year = filter.year ?? currentYearVN();
    // Enrich từ DonHang_Chitiet (DetailRepository — parity status/ngày nhận)
    const [khMap, xeMap, hhMap, details] = await Promise.all([
      MasterRepository.khNames(),
      MasterRepository.xeNames(),
      MasterRepository.hhNames(),
      DetailRepository.findMany({ year }).catch(() => []),
    ]);
    const ctById = new Map(
      details.map((ct) => [String(ct.detailId || "").trim(), ct])
    );
    rows = rows.map((d: Delivery) => {
      const ct = ctById.get(String(d.detailId || "").trim());
      const status = ct?.status || d.detailStatus;
      return {
        ...d,
        customerName:
          d.customerName || khMap[d.customerId] || d.customerId,
        orderDate: d.orderDate || ct?.orderDate || d.deliveryDate,
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
        detailStatus: status,
        actualReceived: ct?.actualReceived ?? d.actualReceived,
        receivedDate: ct?.receivedDate || d.receivedDate,
        isDuyenHa: !!(ct as { isDuyenHa?: boolean } | undefined)?.isDuyenHa || d.isDuyenHa,
        orderId: d.orderId || ct?.orderId || undefined,
      };
    });

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
    // Sort mới → cũ theo ngày đặt lệnh
    rows.sort((a, b) => {
      const da = a.orderDate || a.deliveryDate || "";
      const db = b.orderDate || b.deliveryDate || "";
      if (da !== db) return db.localeCompare(da);
      return (b.deliveryId || "").localeCompare(a.deliveryId || "");
    });

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
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
    const ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }
    const st = String(ct.status || "");
    if (["Xóa xe", "DELETE"].includes(st) || st.toUpperCase() === "DELETE") {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chi tiết đã xóa khỏi đơn, không được lưu giao hàng.",
      };
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
    if (payload.customerId) patch.MaKh = payload.customerId;
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
    let tenHH = detailId;
    try {
      const ct = await DetailRepository.findById(detailId, y);
      if (ct?.productId) {
        const hhRows = await readSheetAsObjects(SHEETS.HH, {});
        const hh = hhRows.find(
          (r) => String(r.MaHH || "").trim() === String(ct.productId).trim()
        );
        if (hh) {
          tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
          tenHH = String(hh.TenHangHoa || ct.productId);
        }
      }
    } catch {
      /* optional */
    }

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
    const ymd =
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");

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
      const maKh = String(r.customerId || "").trim();
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
        // Cấp mã GH chuẩn từ System_Counter (parity V21)
        const idGh = await newDeliveryId(ymdDate(new Date()) || undefined, {
          email: user.email,
          year: y,
        });
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

    return {
      detailId,
      soLuong: sumKh,
      created,
      updated,
      deleted,
      rows: after.length,
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

    const ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
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

    const thucNhan = qty3(Number(ct.actualReceived) || 0);
    if (!(thucNhan > 0)) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chưa có số lượng thực nhận, không thể giao hàng.",
      };
    }

    // HH meta
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

    // Validate từng dòng TG > 0
    for (const item of list) {
      if (!item.customerId) {
        throw { code: "VALIDATION_ERROR", message: "Dòng giao hàng thiếu khách hàng." };
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
        // 1. acghang
        const acg = list.find((x) => x.customerId === "acghang");
        if (acg && remaining > 0.0001) {
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
        // 2. pending khác (TG=0)
        if (remaining > 0.0001) {
          for (const p of list) {
            if (remaining <= 0.0001) break;
            if (p.actualQty > 0) continue;
            if (p.customerId === "acghang") continue;
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
        const acg = list.find((x) => x.customerId === "acghang");
        if (acg) {
          acg.plannedQty = roundStep(acg.plannedQty + amount);
          return;
        }
        const pending = list.filter(
          (item) => item.actualQty === 0 && item.customerId !== "acghang"
        );
        if (pending.length > 0) {
          pending[0].plannedQty = roundStep(pending[0].plannedQty + amount);
          return;
        }
        // Tạo dòng acghang ảo
        list.push({
          deliveryId: `NEW-acg-${Date.now()}`,
          customerId: "acghang",
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

      if (!item.isNew && existingById.has(item.deliveryId)) {
        await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          item.deliveryId,
          {
            MaKh: item.customerId,
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
        const idGh = await newDeliveryId(ymdDate(new Date()) || undefined, {
          email: user.email,
          year: y,
        });
        await appendSheetRow(
          SHEETS.GH,
          {
            ID_Giaohang: idGh,
            ID_Chitiet: detailId,
            MaKh: item.customerId,
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
      idCt: detailId,
      targetId: detailId,
      newValue: JSON.stringify({
        count: list.length,
        totalTg,
        thucNhan,
        sumKh,
      }),
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
