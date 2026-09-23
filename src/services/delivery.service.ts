import type { AccessScope, Delivery, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterByCustomerIds,
  resolveAllowedCustomerIds,
} from "@/lib/scope";
import { DeliveryRepository } from "@/repositories/delivery.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { ReportRepository } from "@/repositories/report.repository";

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
}
