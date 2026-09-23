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
import { ReportRepository } from "@/repositories/report.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

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
    const [payablesAll, openings, details] = await Promise.all([
      ReportRepository.getPayables(year),
      ReportRepository.getOpening(year),
      ReportRepository.getDetails(year),
    ]);

    let payables = payablesAll.filter((p) => p.active);

    if (filter.supplierId) {
      payables = payables.filter((p) => p.supplierId === filter.supplierId);
    }

    let openingsScoped = openings;
    let detailsScoped = details.filter((d) => (d.actualReceived || 0) > 0);
    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      payables = filterBySupplierIds(payables, allowed);
      openingsScoped = filterBySupplierIds(openings, allowed);
      detailsScoped = filterBySupplierIds(detailsScoped, allowed);
    }
    if (filter.supplierId) {
      detailsScoped = detailsScoped.filter(
        (d) => d.supplierId === filter.supplierId
      );
    }

    // DM_GiaMua: lookup DonGia theo MaNCC + MaHH (+ Makv) + TuNgay <= ngày nhận
    type PriceRow = {
      maNcc: string;
      maHh: string;
      maKv: string;
      donGia: number;
      tuNgay: string;
      active: boolean;
    };
    const prices: PriceRow[] = [];
    if (isSheetsConfigured()) {
      try {
        const rows = await readSheetAsObjects(SHEETS.GM, {});
        for (const r of rows) {
          const active = String(r.HoatDong ?? "true").toLowerCase();
          if (active === "false" || active === "0") continue;
          prices.push({
            maNcc: String(r.MaNCC || "").trim(),
            maHh: String(r.MaHH || "").trim(),
            maKv: String(r.Makv || r.MaKV || "").trim(),
            donGia: Number(r.DonGia) || 0,
            tuNgay: String(r.TuNgay || "").slice(0, 10),
            active: true,
          });
        }
      } catch (e) {
        console.info("[Payables] DM_GiaMua unavailable", e);
      }
    }

    function findPrice(
      maNcc: string,
      maHh: string,
      maKv: string,
      onDate: string
    ): number {
      const candidates = prices
        .filter(
          (p) =>
            p.maNcc === maNcc &&
            p.maHh === maHh &&
            (!p.maKv || !maKv || p.maKv === maKv) &&
            (!p.tuNgay || !onDate || p.tuNgay <= onDate)
        )
        .sort((a, b) => (a.tuNgay < b.tuNgay ? 1 : -1));
      return candidates[0]?.donGia || 0;
    }

    // Phát sinh từ thực nhận × đơn giá (theo NCC)
    const phatSinhByNcc: Record<
      string,
      { amount: number; tons: number; lines: number }
    > = {};
    const accrualLines: Array<{
      detailId: string;
      supplierId: string;
      productId: string;
      regionId: string;
      receivedDate: string;
      tons: number;
      unitPrice: number;
      amount: number;
    }> = [];

    for (const d of detailsScoped) {
      const tons = Number(d.actualReceived) || 0;
      if (tons <= 0) continue;
      const onDate = (d.receivedDate || d.orderDate || "").slice(0, 10);
      const unitPrice = findPrice(
        d.supplierId,
        d.productId,
        d.regionId || "",
        onDate
      );
      const amount = Math.round(tons * unitPrice * 100) / 100;
      if (!phatSinhByNcc[d.supplierId]) {
        phatSinhByNcc[d.supplierId] = { amount: 0, tons: 0, lines: 0 };
      }
      phatSinhByNcc[d.supplierId].amount += amount;
      phatSinhByNcc[d.supplierId].tons += tons;
      phatSinhByNcc[d.supplierId].lines += 1;
      if (unitPrice > 0) {
        accrualLines.push({
          detailId: d.detailId,
          supplierId: d.supplierId,
          productId: d.productId,
          regionId: d.regionId || "",
          receivedDate: onDate,
          tons,
          unitPrice,
          amount,
        });
      }
    }

    const nccMap = await MasterRepository.nccNames();

    // Union suppliers from opening + payables + accrual
    const supplierIds = new Set<string>();
    openingsScoped.forEach((o) => supplierIds.add(o.supplierId));
    payables.forEach((p) => supplierIds.add(p.supplierId));
    Object.keys(phatSinhByNcc).forEach((id) => supplierIds.add(id));

    const summary = Array.from(supplierIds).map((supplierId) => {
      const o = openingsScoped.find((x) => x.supplierId === supplierId);
      const related = payables.filter((p) => p.supplierId === supplierId);
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
      const opening = o?.openingAmount || 0;
      const phatSinh = phatSinhByNcc[supplierId]?.amount || 0;
      const tonsNhan = phatSinhByNcc[supplierId]?.tons || 0;
      return {
        supplierId,
        supplierName: o?.supplierName || nccMap[supplierId] || supplierId,
        opening,
        phatSinh,
        tonsNhan: Math.round(tonsNhan * 1000) / 1000,
        paid,
        increase,
        // Dư cuối = đầu kỳ + phát sinh nhận + điều chỉnh tăng − thanh toán/giảm
        closing: opening + phatSinh + increase - paid,
      };
    });

    summary.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));

    return {
      data: {
        payables: applyPagination(payables, filter.page, filter.pageSize).data,
        summary,
        accrualSample: accrualLines.slice(0, 50),
        formula:
          "Phát sinh = Σ (ThucNhan × DonGia từ DM_GiaMua theo MaNCC+MaHH+Makv, TuNgay≤ngày nhận). Cuối kỳ = Đầu kỳ + Phát sinh + ĐC tăng − Thanh toán/CK/Đối trừ/ĐC giảm.",
      },
      meta: {
        year,
        generatedAt: new Date().toISOString(),
        source: "sheets+giamua",
        priceRows: prices.length,
        accrualLines: accrualLines.length,
      },
    };
  }
}
