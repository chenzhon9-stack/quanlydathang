import type { AccessScope, Order, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { OrderRepository } from "@/repositories/order.repository";
import { MasterRepository } from "@/repositories/master.repository";

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
 * OrderService — STEP 5 + AccessScope MANAGEMENT (V21 Quanly `;`)
 */
export class OrderService {
  static async listOrders(
    filter: OrderListFilter,
    user: UserContext,
    scope: AccessScope
  ): Promise<OrderListResult> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    let orders = await OrderRepository.findMany({
      year: filter.year,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      status: filter.status,
      supplierId: filter.supplierId,
    });

    // OWNER: DonHang.User
    if (scope.scopeType === "OWNER" && scope.ownerEmail) {
      const em = scope.ownerEmail.toLowerCase();
      orders = orders.filter(
        (o) => (o.createdBy || "").toLowerCase() === em
      );
    }

    // MANAGEMENT: intersection User.Quanly ∩ NCC.Quanly
    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      orders = filterBySupplierIds(orders, allowed);
    }

    const nccMap = await MasterRepository.nccNames();
    orders = orders.map((o) => ({
      ...o,
      supplierName: o.supplierName || nccMap[o.supplierId] || o.supplierId,
    }));

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
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    const order = await OrderRepository.findById(maDon, year);
    if (!order) {
      throw { code: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" };
    }

    if (
      scope.scopeType === "OWNER" &&
      scope.ownerEmail &&
      (order.createdBy || "").toLowerCase() !== scope.ownerEmail.toLowerCase()
    ) {
      throw {
        code: "SCOPE_DENIED",
        message: "Không thuộc phạm vi dữ liệu của bạn",
      };
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      if (
        allowed &&
        order.supplierId &&
        !allowed.has(order.supplierId)
      ) {
        throw {
          code: "SCOPE_DENIED",
          message: "NCC không thuộc nhóm quản lý của bạn",
        };
      }
    }

    return order;
  }
}
