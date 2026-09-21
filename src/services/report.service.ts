import type {
  ReportFilter,
  PaginatedResult,
  AccessScope,
  UserContext,
  OrderDetail,
  Delivery,
  ProductionPlan,
} from "@/types";
import { hasPermission } from "@/lib/auth";
import { filterBySupplierIds, resolveAllowedSupplierIds, filterByCustomerIds, resolveAllowedCustomerIds } from "@/lib/scope";
import { MasterRepository } from "@/repositories/master.repository";
import { ReportRepository } from "@/repositories/report.repository";

function applyPagination<T>(
  items: T[],
  page = 1,
  pageSize = 50
): PaginatedResult<T> {
  const size = Math.min(pageSize, 100);
  const start = (page - 1) * size;
  const data = items.slice(start, start + size);
  return {
    data,
    meta: {
      page,
      pageSize: size,
      total: items.length,
      totalPages: Math.ceil(items.length / size) || 1,
    },
  };
}

export class ReportService {
  static async getReceiving(
    filter: ReportFilter,
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "DELIVERY_VIEW_ACTUAL_RECEIVE")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem thực nhận",
      };
    }

    // V21: sales / viewer / accountant không xem thực nhận
    const role = String(user.role || "").toUpperCase();
    if (["SALES", "VIEWER", "ACCOUNTANT"].includes(role)) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Bạn không có quyền xem báo cáo thực nhận.",
      };
    }

    const year = filter.year ?? new Date().getFullYear();
    let details = await ReportRepository.getDetails(year);

    details = details.filter(
      (d: OrderDetail) =>
        d.status === "RECEIVED" ||
        d.status === "DELIVERING" ||
        d.status === "DONE"
    );

    if (filter.fromDate) {
      details = details.filter(
        (d) => (d.receivedDate || d.orderDate) >= filter.fromDate!
      );
    }
    if (filter.toDate) {
      details = details.filter(
        (d) => (d.receivedDate || d.orderDate) <= filter.toDate!
      );
    }
    if (filter.supplierId) {
      details = details.filter((d) => d.supplierId === filter.supplierId);
    }
    if (filter.phanLoai?.length) {
      details = details.filter(
        (d) => d.phanLoai && filter.phanLoai!.includes(d.phanLoai)
      );
    }

    // Chỉ dòng có thực nhận > 0 (V21 getReportThucNhan)
    details = details.filter((d) => (d.actualReceived || 0) > 0);

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      details = filterBySupplierIds(details, allowed);
    }

    const [nccMap, hhMap, xeMap] = await Promise.all([
      MasterRepository.nccNames(),
      MasterRepository.hhNames(),
      MasterRepository.xeNames(),
    ]);
    details = details.map((d) => ({
      ...d,
      supplierName: d.supplierName || nccMap[d.supplierId] || d.supplierId,
      productName: d.productName || hhMap[d.productId] || d.productId,
      vehiclePlate: d.vehiclePlate || xeMap[d.vehicleId] || d.vehicleId,
    }));

    return applyPagination(details, filter.page, filter.pageSize);
  }

  static async getDeliveries(
    filter: ReportFilter,
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "DELIVERY_VIEW_ACTUAL_DELIVER")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem thực giao",
      };
    }

    const year = filter.year ?? new Date().getFullYear();
    let deliveries = await ReportRepository.getDeliveries(year);
    deliveries = deliveries.filter((d: Delivery) => !d.deleted);

    if (filter.fromDate) {
      deliveries = deliveries.filter(
        (d) => (d.deliveryDate || "") >= filter.fromDate!
      );
    }
    if (filter.toDate) {
      deliveries = deliveries.filter(
        (d) => (d.deliveryDate || "") <= filter.toDate!
      );
    }
    if (filter.customerId) {
      deliveries = deliveries.filter((d) => d.customerId === filter.customerId);
    }

    if (scope.scopeType === "MANAGEMENT" || scope.scopeType === "OWN_CUSTOMER") {
      const allowed = await resolveAllowedCustomerIds(scope);
      deliveries = filterByCustomerIds(deliveries, allowed);
    }

    const khMap = await MasterRepository.khNames();
    deliveries = deliveries.map((d) => ({
      ...d,
      customerName: d.customerName || khMap[d.customerId] || d.customerId,
    }));

    return applyPagination(deliveries, filter.page, filter.pageSize);
  }

  static async getPlans(
    filter: ReportFilter,
    user: UserContext,
    _scope: AccessScope
  ) {
    if (
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "KHSL_VIEW") &&
      !hasPermission(user, "PLAN_VIEW")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem kế hoạch sản lượng",
      };
    }

    const year = filter.year ?? new Date().getFullYear();
    let plans = await ReportRepository.getPlans(year);

    if (filter.supplierId) {
      plans = plans.filter(
        (p: ProductionPlan) => p.supplierId === filter.supplierId
      );
    }

    return applyPagination(plans, filter.page, filter.pageSize);
  }

  static async getPayables(
    filter: ReportFilter,
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "PAYABLE_VIEW")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem công nợ",
      };
    }

    const year = filter.year ?? new Date().getFullYear();
    const [payablesAll, openings] = await Promise.all([
      ReportRepository.getPayables(year),
      ReportRepository.getOpening(year),
    ]);

    let payables = payablesAll.filter((p) => p.active);

    if (filter.supplierId) {
      payables = payables.filter((p) => p.supplierId === filter.supplierId);
    }

    let openingsScoped = openings;
    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      payables = filterBySupplierIds(payables, allowed);
      openingsScoped = filterBySupplierIds(openings, allowed);
    }

    const summary = openingsScoped.map((o) => {
      const related = payables.filter((p) => p.supplierId === o.supplierId);
      const paid = related
        .filter(
          (p) =>
            p.type === "THANH_TOAN" ||
            p.type === "CHIET_KHAU" ||
            p.type === "DOI_TRU" ||
            p.type === "DIEU_CHINH_GIAM"
        )
        .reduce((s, p) => s + p.amount, 0);
      const increase = related
        .filter((p) => p.type === "DIEU_CHINH_TANG")
        .reduce((s, p) => s + p.amount, 0);

      return {
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        opening: o.openingAmount,
        paid,
        increase,
        closing: o.openingAmount + increase - paid,
      };
    });

    return {
      data: {
        payables: applyPagination(payables, filter.page, filter.pageSize).data,
        summary,
      },
      meta: {
        year,
        generatedAt: new Date().toISOString(),
        source: "sheets-or-mock",
      },
    };
  }
}
