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
      };
    });
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
      const hh = hhRows.find(
        (r) => String(r.MaHH || "").trim() === String(ct.productId || "").trim()
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
}
