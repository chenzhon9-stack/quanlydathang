import type { AccessScope, Delivery, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterByCustomerIds,
  resolveAllowedCustomerIds,
} from "@/lib/scope";
import { DeliveryRepository } from "@/repositories/delivery.repository";
import { MasterRepository } from "@/repositories/master.repository";

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

    // Enrich tên KH
    const khMap = await MasterRepository.khNames();
    rows = rows.map((d: Delivery) => ({
      ...d,
      customerName:
        d.customerName ||
        khMap[d.customerId] ||
        d.customerId,
    }));

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
