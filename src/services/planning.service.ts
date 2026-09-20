import type { AccessScope, ProductionPlan, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import { filterBySupplierIds, resolveAllowedSupplierIds } from "@/lib/scope";
import { ReportRepository } from "@/repositories/report.repository";

export class PlanningService {
  static async listPlans(
    filter: {
      year?: number;
      supplierId?: string;
      page?: number;
      pageSize?: number;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "PLAN_VIEW") &&
      !hasPermission(user, "KHSL_VIEW") &&
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem kế hoạch sản lượng",
      };
    }

    const year = filter.year ?? new Date().getFullYear();
    let plans = await ReportRepository.getPlans(year);
    plans = plans.sort((a, b) => {
      const d = (b.fromDate || "").localeCompare(a.fromDate || "");
      if (d !== 0) return d;
      return (b.id || "").localeCompare(a.id || "");
    });

    if (filter.supplierId) {
      plans = plans.filter((p: ProductionPlan) => p.supplierId === filter.supplierId);
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      plans = filterBySupplierIds(plans, allowed);
    }

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = plans.length;
    const start = (page - 1) * pageSize;
    const items = plans.slice(start, start + pageSize);

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }
}
