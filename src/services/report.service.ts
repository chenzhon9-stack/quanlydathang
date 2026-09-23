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
import {
  mapGiaMuaSheetRow,
  resolveDonGiaMua,
  type GiaMuaRow,
} from "@/lib/finance/giamua";

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
    filter: ReportFilter & { fromDate?: string; toDate?: string },
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

    // V21: fromDate & toDate cùng năm tài chính
    const yearHint = filter.year ?? new Date().getFullYear();
    let fromDate = (filter.fromDate || `${yearHint}-01-01`).slice(0, 10);
    let toDate = (filter.toDate || `${yearHint}-12-31`).slice(0, 10);
    const y1 = Number(fromDate.slice(0, 4));
    const y2 = Number(toDate.slice(0, 4));
    if (!y1 || !y2 || y1 !== y2) {
      throw {
        code: "VALIDATION_ERROR",
        message:
          "Từ ngày và Đến ngày phải cùng một năm tài chính (01/01–31/12).",
      };
    }
    const Y = y1;
    const yearStart = `${Y}-01-01`;
    if (toDate < fromDate) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Đến ngày phải ≥ Từ ngày.",
      };
    }

    const [payablesAll, openings, details] = await Promise.all([
      ReportRepository.getPayables(Y),
      ReportRepository.getOpening(Y),
      ReportRepository.getDetails(Y),
    ]);

    let openingsScoped = openings.filter((o) => o.active !== false);
    let detailsScoped = details.filter((d) => {
      if (d.status === "DELETE") return false;
      if ((d.actualReceived || 0) <= 0) return false;
      const dt = (d.receivedDate || "").slice(0, 10);
      if (!dt) return false;
      // trong năm Y đến toDate (V21: yearStart → toMs)
      return dt >= yearStart && dt <= toDate;
    });
    let payables = payablesAll.filter((p) => p.active);

    if (filter.supplierId) {
      const sid = filter.supplierId;
      openingsScoped = openingsScoped.filter((o) => o.supplierId === sid);
      detailsScoped = detailsScoped.filter((d) => d.supplierId === sid);
      payables = payables.filter((p) => p.supplierId === sid);
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      openingsScoped = filterBySupplierIds(openingsScoped, allowed);
      detailsScoped = filterBySupplierIds(detailsScoped, allowed);
      payables = filterBySupplierIds(payables, allowed);
    }

    // DM_GiaMua
    let prices: GiaMuaRow[] = [];
    if (isSheetsConfigured()) {
      try {
        const rows = await readSheetAsObjects(SHEETS.GM, {});
        prices = rows
          .map(mapGiaMuaSheetRow)
          .filter((x): x is GiaMuaRow => !!x);
      } catch (e) {
        console.info("[Payables] DM_GiaMua", e);
      }
    }

    type NoBucket = {
      truocKy: number;
      trongKy: number;
      thieuGiaTruocKy: number;
      thieuGiaTrongKy: number;
      tonsTruocKy: number;
      tonsTrongKy: number;
    };
    const noByNcc: Record<string, NoBucket> = {};
    const addNo = (
      maNcc: string,
      tien: number,
      thieu: boolean,
      tons: number,
      bucket: "truocKy" | "trongKy"
    ) => {
      if (!noByNcc[maNcc]) {
        noByNcc[maNcc] = {
          truocKy: 0,
          trongKy: 0,
          thieuGiaTruocKy: 0,
          thieuGiaTrongKy: 0,
          tonsTruocKy: 0,
          tonsTrongKy: 0,
        };
      }
      noByNcc[maNcc][bucket] += tien;
      if (bucket === "truocKy") noByNcc[maNcc].tonsTruocKy += tons;
      else noByNcc[maNcc].tonsTrongKy += tons;
      if (thieu) {
        if (bucket === "truocKy") noByNcc[maNcc].thieuGiaTruocKy++;
        else noByNcc[maNcc].thieuGiaTrongKy++;
      }
    };

    for (const d of detailsScoped) {
      const maNcc = d.supplierId;
      const dt = (d.receivedDate || "").slice(0, 10);
      const makv = String(d.regionId || "").trim(); // CT.Khuvuc
      const tons = Number(d.actualReceived) || 0;
      const resolved = resolveDonGiaMua(
        prices,
        maNcc,
        d.productId,
        makv,
        dt
      );
      // V21 doi chieu: toFixed(0) for money on balance
      const tien = resolved.found
        ? Math.round(tons * resolved.donGia)
        : 0;
      const bucket = dt < fromDate ? "truocKy" : "trongKy";
      addNo(maNcc, tien, !resolved.found, tons, bucket);
    }

    // Bên Có: NCC_CongNo — sign: DIEU_CHINH_TANG = +1, còn lại = -1
    type CoBucket = {
      truocKy: number;
      trongKy: number;
      chiTietTrongKy: Record<string, number>;
    };
    const coByNcc: Record<string, CoBucket> = {};
    const signOf = (loai: string) =>
      String(loai || "").toUpperCase() === "DIEU_CHINH_TANG" ? 1 : -1;

    for (const p of payables) {
      const dt = (p.date || "").slice(0, 10);
      if (!dt || dt < yearStart || dt > toDate) continue;
      const maNcc = p.supplierId;
      if (!coByNcc[maNcc]) {
        coByNcc[maNcc] = { truocKy: 0, trongKy: 0, chiTietTrongKy: {} };
      }
      const signed = signOf(p.type) * (Number(p.amount) || 0);
      if (dt < fromDate) {
        coByNcc[maNcc].truocKy += signed;
      } else {
        coByNcc[maNcc].trongKy += signed;
        const k = String(p.type || "").toUpperCase();
        coByNcc[maNcc].chiTietTrongKy[k] =
          (coByNcc[maNcc].chiTietTrongKy[k] || 0) + (Number(p.amount) || 0);
      }
    }

    const duDauNamMap: Record<string, number> = {};
    openingsScoped.forEach((o) => {
      duDauNamMap[o.supplierId] = Number(o.openingAmount) || 0;
    });

    const nccMap = await MasterRepository.nccNames();
    const allNcc = new Set<string>([
      ...Object.keys(noByNcc),
      ...Object.keys(coByNcc),
      ...Object.keys(duDauNamMap),
    ]);

    const summary = Array.from(allNcc).map((maNcc) => {
      const no = noByNcc[maNcc] || {
        truocKy: 0,
        trongKy: 0,
        thieuGiaTruocKy: 0,
        thieuGiaTrongKy: 0,
        tonsTruocKy: 0,
        tonsTrongKy: 0,
      };
      const co = coByNcc[maNcc] || {
        truocKy: 0,
        trongKy: 0,
        chiTietTrongKy: {},
      };
      const hasDuDauNam = Object.prototype.hasOwnProperty.call(
        duDauNamMap,
        maNcc
      );
      const duDauNam = Number(duDauNamMap[maNcc] || 0);
      // V21: duDauKy = duDauNam + no.truocKy + co.truocKy
      const duDauKy = Math.round(duDauNam + no.truocKy + co.truocKy);
      const duCuoi = Math.round(duDauKy + no.trongKy + co.trongKy);
      const ct = co.chiTietTrongKy;
      return {
        supplierId: maNcc,
        supplierName: nccMap[maNcc] || maNcc,
        coDuDauNam: hasDuDauNam,
        opening: duDauNam, // alias
        duDauNam,
        duDauKy,
        phatSinh: Math.round(no.trongKy * 100) / 100, // phaiTraTrongKy
        phaiTraTrongKy: Math.round(no.trongKy * 100) / 100,
        tonsNhan: Math.round(no.tonsTrongKy * 1000) / 1000,
        increase: Math.round(ct["DIEU_CHINH_TANG"] || 0),
        paid: Math.round(ct["THANH_TOAN"] || 0),
        chietKhau: Math.round(ct["CHIET_KHAU"] || 0),
        doiTru: Math.round(ct["DOI_TRU"] || 0),
        dieuChinhGiam: Math.round(ct["DIEU_CHINH_GIAM"] || 0),
        closing: duCuoi,
        duCuoi,
        soDongThieuGia: no.thieuGiaTrongKy,
        soDongThieuGiaTruocKy: no.thieuGiaTruocKy,
      };
    });

    summary.sort((a, b) =>
      String(a.supplierName).localeCompare(String(b.supplierName), "vi")
    );

    return {
      data: {
        payables: applyPagination(payables, filter.page, filter.pageSize).data,
        summary,
        formula:
          "V21 Đối chiếu công nợ: Dư đầu kỳ = Dư đầu năm + (Nhận×Giá + sổ Có) trước kỳ. " +
          "Phải trả trong kỳ = Σ ThucNhan×DonGia (NgayNhan trong kỳ; giá: Makv exact → Makv trống, TuNgay≤ngày nhận). " +
          "Dư cuối = Dư đầu kỳ + Phải trả + ĐC tăng − TT − CK − Đối trừ − ĐC giảm.",
      },
      meta: {
        year: Y,
        fromDate,
        toDate,
        yearStart,
        generatedAt: new Date().toISOString(),
        source: "v21-doi-chieu-cong-no",
        priceRows: prices.length,
        soDongThieuGiaTong: summary.reduce(
          (s, r) => s + (r.soDongThieuGia || 0),
          0
        ),
      },
    };
  }

}
