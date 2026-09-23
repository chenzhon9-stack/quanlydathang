import type { AccessScope, Delivery, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterByCustomerIds,
  resolveAllowedCustomerIds,
} from "@/lib/scope";
import { DeliveryRepository } from "@/repositories/delivery.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { ReportRepository } from "@/repositories/report.repository";
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { todayYmdVN } from "@/lib/status";

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
    const year = filter.year ?? new Date().getFullYear();
    const [khMap, xeMap, hhMap, details] = await Promise.all([
      MasterRepository.khNames(),
      MasterRepository.xeNames(),
      MasterRepository.hhNames(),
      ReportRepository.getDetails(year).catch(() => [] as Awaited<
        ReturnType<typeof ReportRepository.getDetails>
      >),
    ]);
    const ctById = new Map(
      details.map((ct) => [
        ct.detailId,
        {
          orderDate: ct.orderDate,
          vehicleId: ct.vehicleId,
          productId: ct.productId,
        },
      ])
    );
    rows = rows.map((d: Delivery) => {
      const ct = ctById.get(d.detailId);
      return {
        ...d,
        customerName:
          d.customerName || khMap[d.customerId] || d.customerId,
        orderDate: d.orderDate || ct?.orderDate || d.deliveryDate,
        vehicleId: d.vehicleId || ct?.vehicleId,
        vehiclePlate:
          d.vehiclePlate ||
          (ct?.vehicleId ? xeMap[ct.vehicleId] : undefined) ||
          ct?.vehicleId,
        productId: d.productId || ct?.productId,
        productName:
          d.productName ||
          (ct?.productId ? hhMap[ct.productId] : undefined) ||
          ct?.productId,
      };
    });
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


  /** Cập nhật thực giao — V21 saveDelivery (một dòng) */
  static async updateDelivery(
    deliveryId: string,
    payload: { actualQty: number; deliveryDate?: string; note?: string },
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
    const qty = Number(payload.actualQty);
    if (qty < 0) {
      throw { code: "VALIDATION_ERROR", message: "Thực giao không hợp lệ" };
    }
    const ngay = (payload.deliveryDate || todayYmdVN()).slice(0, 10);
    const y = year ?? new Date().getFullYear();
    const patch: Record<string, string | number | boolean> = {
      ThucGiao: qty,
      Ngaygiao: ngay,
    };
    if (payload.note !== undefined) patch.Ghichu = payload.note;
    const row = await updateSheetRowByKey(
      SHEETS.GH,
      "ID_Giaohang",
      deliveryId,
      patch,
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy GH " + deliveryId };
    return { deliveryId, actualQty: qty, deliveryDate: ngay, row };
  }
}
