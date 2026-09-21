import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { DetailRepository } from "@/repositories/detail.repository";
import { MasterRepository } from "@/repositories/master.repository";

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
