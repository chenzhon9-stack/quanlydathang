import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import { DeliveryRepository } from "@/repositories/delivery.repository";

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
    _scope: AccessScope
  ) {
    if (
      !hasPermission(user, "DELIVERY_VIEW") &&
      !hasPermission(user, "ORDER_VIEW") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem giao hàng" };
    }

    const rows = await DeliveryRepository.findMany(filter);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    return { items, page, pageSize, total, hasMore: start + items.length < total };
  }
}
