import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { DetailRepository } from "@/repositories/detail.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { STATUS_CT, todayYmdVN } from "@/lib/status";
import {
  qty3,
  validateStep,
  validateReceiveDate,
} from "@/lib/business-rules";
import { readSheetAsObjects } from "@/lib/sheets/dal";

export class DetailService {
  static async listDetails(
    filter: {
      year?: number;
      fromDate?: string;
      toDate?: string;
      status?: string;
      orderId?: string;
      supplierId?: string;
      page?: number;
      pageSize?: number;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem chi tiết xe",
      };
    }

    let rows = await DetailRepository.findMany(filter);

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      rows = filterBySupplierIds(rows, allowed);
    }

    const [nccMap, hhMap, xeMap, kvMap, htvtMap] = await Promise.all([
      MasterRepository.nccNames(),
      MasterRepository.hhNames(),
      MasterRepository.xeNames(),
      MasterRepository.kvNames(),
      MasterRepository.htvtNames(),
    ]);
    rows = rows.map((d) => ({
      ...d,
      supplierName: (d as { supplierName?: string }).supplierName || nccMap[d.supplierId] || d.supplierId,
      productName: d.productName || hhMap[d.productId] || d.productId,
      vehiclePlate: xeMap[d.vehicleId] || d.vehicleId,
      regionName: kvMap[d.regionId] || d.regionId,
      transportTypeName: d.transportTypeName || htvtMap[d.transportTypeId || ""] || d.transportTypeId,
    })) as typeof rows;

    // Tổng thực giao theo CT (cho cột Tồn / Thực giao)
    try {
      const { DeliveryRepository } = await import("@/repositories/delivery.repository");
      const year = filter.year ?? new Date().getFullYear();
      const allGh = await DeliveryRepository.findMany({ year, includeDeleted: false });
      const sumByCt: Record<string, number> = {};
      for (const g of allGh) {
        sumByCt[g.detailId] = (sumByCt[g.detailId] || 0) + (Number(g.actualQty) || 0);
      }
      rows = rows.map((d) => ({
        ...d,
        actualDelivered: sumByCt[d.detailId] || 0,
      })) as typeof rows;
    } catch {
      /* optional */
    }

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
   * Nhận hàng — parity V21 confirmReceiveDetail
   * - permission ORDER_RECEIVE
   * - status not CANCEL/DELETE/DONE
   * - ThucNhan > 0 + chia hết TyleChiahet
   * - ngày nhận hợp lệ
   * - ghi CT → Đã nhận
   * - nếu ThucNhan ≠ SoLuong: phân bổ tỷ lệ KHgiao (active GH)
   */
  static async receiveDetail(
    detailId: string,
    payload: { actualReceived: number; receivedDate?: string },
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_RECEIVE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền nhận hàng" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }

    const y = year ?? new Date().getFullYear();
    const ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    const st = String(ct.status || "").toUpperCase();
    // status domain enum or VN
    const blocked = ["CANCEL", "DELETE", "DONE", "HỦY XE", "XÓA XE", "HOÀN THÀNH"];
    if (blocked.includes(st) || ["Hủy xe", "Xóa xe", "Hoàn thành"].includes(String(ct.status))) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chi tiết đã hủy/xóa hoặc hoàn thành, không được nhận hàng.",
      };
    }

    const qty = qty3(Number(payload.actualReceived));
    if (!(qty > 0)) {
      throw { code: "VALIDATION_ERROR", message: "Thực nhận phải > 0" };
    }

    // TyleChiahet từ DM_HangHoa
    let tyleChiahet = 0;
    let tenHH = ct.productName || ct.productId;
    try {
      const hhRows = await readSheetAsObjects(SHEETS.HH, {});
      const hh = hhRows.find(
        (r) => String(r.MaHH || "").trim() === String(ct.productId || "").trim()
      );
      if (hh) {
        tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
        tenHH = String(hh.TenHangHoa || tenHH);
      }
    } catch {
      /* optional */
    }
    if (!validateStep(qty, tyleChiahet)) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Thực nhận của ${tenHH} phải chia hết cho ${tyleChiahet}. Giá trị hiện tại: ${qty.toFixed(2)} tấn.`,
      };
    }

    const ngay = (payload.receivedDate || todayYmdVN()).slice(0, 10);
    const dateCheck = validateReceiveDate({
      orderDate: ct.orderDate,
      receivedDate: ngay,
      isDuyenHa: !!ct.isDuyenHa,
    });
    if (!dateCheck.ok) {
      throw { code: "VALIDATION_ERROR", message: dateCheck.error };
    }

    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        ThucNhan: qty,
        NgayNhanHang: ngay,
        TrangThaiXe: STATUS_CT.RECEIVED,
        TimeChange: new Date().toISOString(),
        User: user.email,
      },
      y
    );
    if (row < 0) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    // Phân bổ lại KHgiao nếu lệch SoLuong (tỷ lệ; làm tròn qty3)
    let redistributed = 0;
    const planQty = qty3(Number(ct.quantity) || 0);
    if (planQty > 0 && Math.abs(qty - planQty) > 0.0001) {
      try {
        const { DeliveryRepository } = await import(
          "@/repositories/delivery.repository"
        );
        const ghs = await DeliveryRepository.findMany({
          year: y,
          detailId,
          includeDeleted: false,
        });
        const active = ghs.filter((g) => !g.deleted);
        const sumPlan = active.reduce((s, g) => s + (Number(g.plannedQty) || 0), 0);
        if (active.length && sumPlan > 0) {
          let allocated = 0;
          for (let i = 0; i < active.length; i++) {
            const g = active[i];
            let newKh: number;
            if (i === active.length - 1) {
              newKh = qty3(qty - allocated);
            } else {
              const ratio = (Number(g.plannedQty) || 0) / sumPlan;
              newKh = qty3(qty * ratio);
              allocated = qty3(allocated + newKh);
            }
            if (Math.abs(newKh - (Number(g.plannedQty) || 0)) > 0.0001) {
              await updateSheetRowByKey(
                SHEETS.GH,
                "ID_Giaohang",
                g.deliveryId,
                { KHgiao: newKh },
                y
              );
              redistributed++;
            }
          }
          // Đồng bộ SoLuong CT = ThucNhan (sau phân bổ)
          await updateSheetRowByKey(
            SHEETS.CT,
            "ID_Chitiet",
            detailId,
            { SoLuong: qty },
            y
          );
        }
      } catch (e) {
        console.error("[receiveDetail] redistribute GH", e);
      }
    }

    return {
      detailId,
      actualReceived: qty,
      receivedDate: ngay,
      status: "RECEIVED",
      row,
      tyleChiahet,
      redistributed,
      message:
        redistributed > 0
          ? `Đã nhận ${qty} tấn; phân bổ lại ${redistributed} dòng KH giao`
          : `Đã nhận ${qty} tấn`,
    };
  }

  /** Hủy / Xóa xe — V21 cancelDetail */
  static async cancelDetail(
    detailId: string,
    mode: "cancel" | "delete",
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "ORDER_CANCEL") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền hủy chi tiết" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const status = mode === "delete" ? STATUS_CT.DELETE : STATUS_CT.CANCEL;
    const y = year ?? new Date().getFullYear();
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        TrangThaiXe: status,
        ThucNhan: 0,
        TimeChange: new Date().toISOString(),
        User: user.email,
      },
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    return { detailId, status: mode === "delete" ? "DELETE" : "CANCEL", row };
  }


  /** Sửa hàng / khu vực / ghi chú — V21 saveEditDetail */
  static async updateDetail(
    detailId: string,
    payload: {
      productId?: string;
      regionId?: string;
      note?: string;
    },
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền sửa chi tiết" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const patch: Record<string, string | number | boolean> = {
      TimeChange: new Date().toISOString(),
      User: user.email,
    };
    if (payload.productId !== undefined) patch.MaHH = payload.productId;
    if (payload.regionId !== undefined) patch.Khuvuc = payload.regionId;
    if (payload.note !== undefined) patch.GhiChu = payload.note;
    const y = year ?? new Date().getFullYear();
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      patch,
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    return { detailId, ...payload, row };
  }
}
