import type { AccessScope, OrderDetail, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import { DetailRepository } from "@/repositories/detail.repository";

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
    _scope: AccessScope
  ) {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem chi tiết xe" };
    }

    const rows = await DetailRepository.findMany(filter);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    return { items, page, pageSize, total, hasMore: start + items.length < total };
  }
}
