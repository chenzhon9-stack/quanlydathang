import type { AccessScope, Order, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import { OrderRepository } from "@/repositories/order.repository";

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
 * OrderService — skill STEP 5 / D61–D63
 * Controller không filter scope thủ công; Service + AccessScope áp dụng.
 */
export class OrderService {
  static async listOrders(
    filter: OrderListFilter,
    user: UserContext,
    scope: AccessScope
  ): Promise<OrderListResult> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      // ADMIN has *; PURCHASE/DISPATCHER have ORDER_VIEW
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem đơn hàng" };
    }

    let orders = await OrderRepository.findMany({
      year: filter.year,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      status: filter.status,
      supplierId: filter.supplierId,
    });

    // D58 — scope ở backend
    if (scope.scopeType === "OWNER" && scope.ownerEmail) {
      orders = orders.filter((o) => o.createdBy === scope.ownerEmail);
    }
    // MANAGEMENT / ALL: phase này chưa filter theo quanly NCC (cần master)

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
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem đơn hàng" };
    }

    const order = await OrderRepository.findById(maDon, year);
    if (!order) {
      throw { code: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" };
    }

    if (
      scope.scopeType === "OWNER" &&
      scope.ownerEmail &&
      order.createdBy !== scope.ownerEmail
    ) {
      throw { code: "SCOPE_DENIED", message: "Không thuộc phạm vi dữ liệu của bạn" };
    }

    return order;
  }
}
