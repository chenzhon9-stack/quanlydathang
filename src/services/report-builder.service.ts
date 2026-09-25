/**
 * Report Builder — parity V21 getReportThucNhan / ThucGiao / …
 * Raw rows + dynamic groupBy + SUM measures.
 */
import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
  filterByCustomerIds,
  resolveAllowedCustomerIds,
} from "@/lib/scope";
import { ReportRepository } from "@/repositories/report.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
import { isExcludedDetailStatus } from "@/lib/reports/exclude-detail";
  dynamicGroupBy,
  applyDynamicSort,
  REPORT_SCHEMAS,
  type ReportType,
  type Measure,
} from "@/lib/reports/dynamic-group";

export interface ReportBuilderParams {
  fromDate?: string;
  toDate?: string;
  year?: number;
  groupBy?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: {
    ncc?: string[];
    hangHoa?: string[];
    htvt?: string[];
    phanLoai?: string[];
  };
  page?: number;
  pageSize?: number;
}

function classifyPhanLoai(raw: string): string {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi") return "Rời";
  return "Khác";
}

async function loadXeExtra(): Promise<
  Record<string, { plate: string; maHTVT: string; tenHTVT: string; maDVT: string; tenDVT: string }>
> {
  const map: Record<
    string,
    { plate: string; maHTVT: string; tenHTVT: string; maDVT: string; tenDVT: string }
  > = {};
  if (!isSheetsConfigured()) return map;
  try {
    const rows = await readSheetAsObjects(SHEETS.XE, {});
    for (const r of rows) {
      const ma = String(r.MaXe || "").trim();
      if (!ma) continue;
      map[ma] = {
        plate: String(r.BienSoXe || ma),
        maHTVT: String(r.MaHTVT || ""),
        tenHTVT: String(r.TenHTVT || ""),
        maDVT: String(r.MaDVT || ""),
        tenDVT: String(r.TenDVT || ""),
      };
    }
  } catch (e) {
    console.error("[ReportBuilder] XE", e);
  }
  return map;
}

async function loadHhPhanLoai(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!isSheetsConfigured()) return map;
  try {
    const rows = await readSheetAsObjects(SHEETS.HH, {});
    for (const r of rows) {
      const ma = String(r.MaHH || "").trim();
      if (ma) map[ma] = String(r.PhanLoaiHH || "");
    }
  } catch {
    /* ignore */
  }
  return map;
}

function denySalesViewerAccountant(user: UserContext, report: ReportType) {
  const role = String(user.role || "").toUpperCase();
  // V21: SALES/VIEWER/ACCOUNTANT → thuc_giao + van_tai only
  if (["SALES", "VIEWER", "ACCOUNTANT", "ACCOUNT"].includes(role)) {
    const allowed: ReportType[] = ["thuc_giao", "van_tai"];
    if (!allowed.includes(report)) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Bạn không có quyền xem báo cáo này.",
      };
    }
  }
}

export class ReportBuilderService {
  static schema(type: ReportType) {
    return REPORT_SCHEMAS[type];
  }

  static async run(
    type: ReportType,
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "REPORT_VIEW") &&
      !hasPermission(user, "*") &&
      !hasPermission(user, "DELIVERY_VIEW")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem báo cáo" };
    }
    denySalesViewerAccountant(user, type);

    const schema = REPORT_SCHEMAS[type];
    const groupBy =
      params.groupBy?.filter((k) =>
        schema.dimensions.some((d) => d.key === k)
      ) || [...schema.defaultGroupBy];
    const sortBy = params.sortBy || schema.defaultSort;
    const sortOrder = params.sortOrder || "desc";

    let raw: Record<string, unknown>[] = [];
    if (type === "thuc_nhan") raw = await this.buildThucNhan(params, user, scope);
    else if (type === "thuc_giao")
      raw = await this.buildThucGiao(params, user, scope);
    else if (type === "giao_nhan")
      raw = await this.buildGiaoNhan(params, user, scope);
    else if (type === "doi_chieu")
      raw = await this.buildDoiChieu(params, user, scope);
    else if (type === "van_tai")
      raw = await this.buildVanTai(params, user, scope);
    else if (type === "vong_doi")
      raw = await this.buildVongDoi(params, user, scope);

    const measures: Measure[] = schema.measures.map((m) => ({
      field: m.key,
      agg: m.key.startsWith("soChuyen") ? "SUM" : "SUM",
    }));

    let result = dynamicGroupBy(raw, groupBy, measures);
    result = applyDynamicSort(result, sortBy, sortOrder);

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 100));
    const total = result.length;
    const start = (page - 1) * pageSize;
    const items = result.slice(start, start + pageSize);

    // totals
    const totals: Record<string, number> = {};
    schema.measures.forEach((m) => {
      totals[m.key] = result.reduce(
        (s, r) => s + (Number(r[m.key]) || 0),
        0
      );
    });

    return {
      type,
      groupBy,
      dimensions: schema.dimensions,
      measureCols: schema.measures,
      items,
      totals,
      meta: {
        page,
        pageSize,
        total,
        hasMore: start + items.length < total,
        rawCount: raw.length,
        fromDate: params.fromDate || null,
        toDate: params.toDate || null,
      },
    };
  }

  private static async yearsFor(params: ReportBuilderParams): Promise<number[]> {
    if (params.fromDate && params.toDate) {
      const y1 = Number(params.fromDate.slice(0, 4));
      const y2 = Number(params.toDate.slice(0, 4));
      const ys: number[] = [];
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) ys.push(y);
      return ys.length ? ys : [new Date().getFullYear()];
    }
    return [params.year ?? new Date().getFullYear()];
  }

  private static async buildThucNhan(
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    const years = await this.yearsFor(params);
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();

    // dedupe
    const seen = new Set<string>();
    details = details.filter((d) => {
      if (!d.detailId || seen.has(d.detailId)) return false;
      seen.add(d.detailId);
      // V21: skip Xóa xe; Hủy xe (và status CANCEL/DELETE) — không vào sản lượng
      if (isExcludedDetailStatus(d.status)) return false;
      return (d.actualReceived || 0) > 0;
    });

    if (scope.scopeType === "OWNER" && scope.ownerEmail) {
      // need order user — skip strict for now
    }
    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      details = filterBySupplierIds(details, allowed);
    }

    const [nccMap, hhMap, xeExtra, plMap] = await Promise.all([
      MasterRepository.nccNames(),
      MasterRepository.hhNames(),
      loadXeExtra(),
      loadHhPhanLoai(),
    ]);

    const rows: Record<string, unknown>[] = [];
    for (const d of details) {
      const dt = d.receivedDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;
      if (params.filters?.ncc?.length && !params.filters.ncc.includes(d.supplierId))
        continue;
      if (
        params.filters?.hangHoa?.length &&
        !params.filters.hangHoa.includes(d.productId)
      )
        continue;

      const xe = xeExtra[d.vehicleId] || {
        plate: d.vehicleId,
        maHTVT: d.transportTypeId || "",
        tenHTVT: d.transportTypeName || "",
        maDVT: "",
        tenDVT: "",
      };
      const pl = classifyPhanLoai(d.phanLoai || plMap[d.productId] || "");
      if (
        params.filters?.phanLoai?.length &&
        !params.filters.phanLoai.includes(pl)
      )
        continue;
      if (
        params.filters?.htvt?.length &&
        !params.filters.htvt.includes(xe.maHTVT)
      )
        continue;

      rows.push({
        ncc: nccMap[d.supplierId] || d.supplierId,
        MaNCC: d.supplierId,
        hangHoa: hhMap[d.productId] || d.productId,
        MaHH: d.productId,
        phanLoai: pl,
        htvt: xe.tenHTVT || d.transportTypeName || xe.maHTVT || "—",
        MaHTVT: xe.maHTVT || d.transportTypeId || "",
        dvt: xe.tenDVT || "—",
        MaDVT: xe.maDVT,
        xe: xe.plate || d.vehicleId,
        MaXe: d.vehicleId,
        ngayNhan: dt,
        thucNhan: d.actualReceived || 0,
        soChuyenNhan: 1,
      });
    }
    return rows;
  }

  private static async buildThucGiao(
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    const years = await this.yearsFor(params);
    let dels = (
      await Promise.all(years.map((y) => ReportRepository.getDeliveries(y)))
    ).flat();
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();

    const detMap = new Map(
      details.map((d) => [
        d.detailId,
        d,
      ])
    );

    dels = dels.filter((d) => !d.deleted && (d.actualQty || 0) > 0);

    if (scope.scopeType === "MANAGEMENT" || scope.scopeType === "OWN_CUSTOMER") {
      const allowed = await resolveAllowedCustomerIds(scope);
      dels = filterByCustomerIds(dels, allowed);
    }

    const [khMap, hhMap, xeExtra, plMap] = await Promise.all([
      MasterRepository.khNames(),
      MasterRepository.hhNames(),
      loadXeExtra(),
      loadHhPhanLoai(),
    ]);

    const rows: Record<string, unknown>[] = [];
    for (const g of dels) {
      const dt = g.deliveryDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;

      const ct = detMap.get(g.detailId);
      const productId = ct?.productId || "";
      const vehicleId = ct?.vehicleId || "";
      const xe = xeExtra[vehicleId] || {
        plate: vehicleId,
        maHTVT: ct?.transportTypeId || "",
        tenHTVT: ct?.transportTypeName || "",
        maDVT: "",
        tenDVT: "",
      };
      const pl = classifyPhanLoai(ct?.phanLoai || plMap[productId] || "");

      if (
        params.filters?.hangHoa?.length &&
        !params.filters.hangHoa.includes(productId)
      )
        continue;

      rows.push({
        khachHang: g.customerName || khMap[g.customerId] || g.customerId,
        MaKh: g.customerId,
        hangHoa: hhMap[productId] || productId || "—",
        MaHH: productId,
        phanLoai: pl,
        htvt: xe.tenHTVT || "—",
        MaHTVT: xe.maHTVT,
        dvt: xe.tenDVT || "—",
        MaDVT: xe.maDVT,
        xe: xe.plate || vehicleId || "—",
        MaXe: vehicleId,
        ngayGiao: dt,
        thucGiao: g.actualQty || 0,
        soChuyenGiao: 1,
      });
    }
    return rows;
  }

  private static async buildGiaoNhan(
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    // GH rows with planned + actual, join CT for xe/hh
    const years = await this.yearsFor(params);
    let dels = (
      await Promise.all(years.map((y) => ReportRepository.getDeliveries(y)))
    ).flat();
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();
    const detMap = new Map(details.map((d) => [d.detailId, d]));
    dels = dels.filter((d) => !d.deleted);

    if (scope.scopeType === "MANAGEMENT" || scope.scopeType === "OWN_CUSTOMER") {
      const allowed = await resolveAllowedCustomerIds(scope);
      dels = filterByCustomerIds(dels, allowed);
    }

    const [khMap, hhMap, xeExtra, nccMap] = await Promise.all([
      MasterRepository.khNames(),
      MasterRepository.hhNames(),
      loadXeExtra(),
      MasterRepository.nccNames(),
    ]);

    const rows: Record<string, unknown>[] = [];
    for (const g of dels) {
      const dt = g.deliveryDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;
      const ct = detMap.get(g.detailId);
      if (ct && isExcludedDetailStatus(ct.status)) continue;
      const vehicleId = ct?.vehicleId || "";
      const productId = ct?.productId || "";
      const xe = xeExtra[vehicleId];
      const khGiao = g.plannedQty || 0;
      const thucGiao = g.actualQty || 0;
      const maNcc = ct?.supplierId || "";
      rows.push({
        xe: xe?.plate || vehicleId || "—",
        khachHang: g.customerName || khMap[g.customerId] || g.customerId,
        hangHoa: hhMap[productId] || productId || "—",
        ncc: ct?.supplierName || nccMap[maNcc] || maNcc || "—",
        ngayGiao: dt,
        dvt: xe?.tenDVT || "—",
        khGiao,
        thucGiao,
        chenhLech: thucGiao - khGiao,
        soChuyenGiao: 1,
      });
    }
    return rows;
  }

  private static async buildDoiChieu(
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    // Per CT: thucNhan vs sum thucGiao
    const years = await this.yearsFor(params);
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();
    let dels = (
      await Promise.all(years.map((y) => ReportRepository.getDeliveries(y)))
    ).flat();

    details = details.filter((d) => !isExcludedDetailStatus(d.status));
    const activeCtIds = new Set(details.map((d) => d.detailId));
    dels = dels.filter((g) => !g.deleted && activeCtIds.has(g.detailId));

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      details = filterBySupplierIds(details, allowed);
    }

    const ghByCt: Record<string, number> = {};
    for (const g of dels) {
      if (g.deleted) continue;
      ghByCt[g.detailId] = (ghByCt[g.detailId] || 0) + (g.actualQty || 0);
    }

    const [nccMap, hhMap, xeExtra, plMap] = await Promise.all([
      MasterRepository.nccNames(),
      MasterRepository.hhNames(),
      loadXeExtra(),
      loadHhPhanLoai(),
    ]);

    const rows: Record<string, unknown>[] = [];
    for (const d of details) {
      const thucNhan = d.actualReceived || 0;
      const thucGiao = ghByCt[d.detailId] || 0;
      if (thucNhan <= 0 && thucGiao <= 0) continue;
      const dt = d.receivedDate || d.orderDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;
      const xe = xeExtra[d.vehicleId];
      const pl = classifyPhanLoai(d.phanLoai || plMap[d.productId] || "");
      rows.push({
        ncc: nccMap[d.supplierId] || d.supplierId,
        hangHoa: hhMap[d.productId] || d.productId,
        xe: xe?.plate || d.vehicleId,
        phanLoai: pl,
        maDon: d.orderId || "",
        thucNhan,
        thucGiao,
        ton: thucNhan - thucGiao,
        soChiTiet: 1,
      });
    }
    return rows;
  }

  private static async buildVanTai(
    params: ReportBuilderParams,
    user: UserContext,
    scope: AccessScope
  ) {
    // Similar to thuc giao + thucNhan from CT
    const years = await this.yearsFor(params);
    let dels = (
      await Promise.all(years.map((y) => ReportRepository.getDeliveries(y)))
    ).flat();
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();
    const detMap = new Map(details.map((d) => [d.detailId, d]));
    dels = dels.filter((d) => !d.deleted && (d.actualQty || 0) > 0);

    if (scope.scopeType === "MANAGEMENT" || scope.scopeType === "OWN_CUSTOMER") {
      const allowed = await resolveAllowedCustomerIds(scope);
      dels = filterByCustomerIds(dels, allowed);
    }

    const [khMap, hhMap, xeExtra] = await Promise.all([
      MasterRepository.khNames(),
      MasterRepository.hhNames(),
      loadXeExtra(),
    ]);

    const rows: Record<string, unknown>[] = [];
    for (const g of dels) {
      const dt = g.deliveryDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;
      const ct = detMap.get(g.detailId);
      if (ct && isExcludedDetailStatus(ct.status)) continue;
      const vehicleId = ct?.vehicleId || "";
      const productId = ct?.productId || "";
      const xe = xeExtra[vehicleId] || {
        plate: vehicleId,
        maDVT: "",
        tenDVT: "",
        maHTVT: "",
        tenHTVT: "",
      };
      rows.push({
        dvt: xe.tenDVT || "—",
        xe: xe.plate || vehicleId || "—",
        khachHang: g.customerName || khMap[g.customerId] || g.customerId,
        hangHoa: hhMap[productId] || productId || "—",
        ngayGiao: dt,
        htvt: xe.tenHTVT || xe.maHTVT || "—",
        thucGiao: g.actualQty || 0,
        thucNhan: ct?.actualReceived || 0,
        soChuyenVT: 1,
      });
    }
    return rows;
  }

  /** Vòng đời đơn: 1 dòng / MaDon — SL đặt, nhận, giao, tỷ lệ */
  private static async buildVongDoi(
    params: ReportBuilderParams,
    _user: UserContext,
    scope: AccessScope
  ) {
    const years = await this.yearsFor(params);
    let orders = (
      await Promise.all(years.map((y) => ReportRepository.getOrders(y)))
    ).flat();
    let details = (
      await Promise.all(years.map((y) => ReportRepository.getDetails(y)))
    ).flat();
    const dels = (
      await Promise.all(years.map((y) => ReportRepository.getDeliveries(y)))
    ).flat();

    const seenO = new Set<string>();
    orders = orders.filter((o) => {
      if (!o.orderId || seenO.has(o.orderId)) return false;
      seenO.add(o.orderId);
      return true;
    });

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      orders = filterBySupplierIds(orders, allowed);
      details = filterBySupplierIds(details, allowed);
    }
    if (scope.scopeType === "OWNER" && scope.ownerEmail) {
      const em = scope.ownerEmail.toLowerCase();
      orders = orders.filter(
        (o) => String(o.createdBy || "").toLowerCase() === em
      );
    }

    const nccMap = await MasterRepository.nccNames();

    type Agg = {
      soChiTiet: number;
      soLuongDat: number;
      thucNhan: number;
    };
    const byDon: Record<string, Agg> = {};
    const detailToOrder: Record<string, string> = {};
    for (const d of details) {
      if (isExcludedDetailStatus(d.status)) continue;
      const mid = d.orderId || "";
      if (!mid) continue;
      detailToOrder[d.detailId] = mid;
      if (!byDon[mid]) {
        byDon[mid] = { soChiTiet: 0, soLuongDat: 0, thucNhan: 0 };
      }
      byDon[mid].soChiTiet += 1;
      byDon[mid].soLuongDat += Number(d.quantity) || 0;
      byDon[mid].thucNhan += Number(d.actualReceived) || 0;
    }

    const ghByDon: Record<string, { thucGiao: number; soChuyen: number }> = {};
    for (const g of dels) {
      if (g.deleted) continue;
      const mid = detailToOrder[g.detailId];
      if (!mid) continue;
      if (!ghByDon[mid]) ghByDon[mid] = { thucGiao: 0, soChuyen: 0 };
      ghByDon[mid].thucGiao += Number(g.actualQty) || 0;
      ghByDon[mid].soChuyen += 1;
    }

    const rows: Record<string, unknown>[] = [];
    for (const o of orders) {
      const dt = o.orderDate || "";
      if (params.fromDate && dt && dt < params.fromDate) continue;
      if (params.toDate && dt && dt > params.toDate) continue;
      const agg = byDon[o.orderId] || {
        soChiTiet: 0,
        soLuongDat: 0,
        thucNhan: 0,
      };
      const gh = ghByDon[o.orderId] || { thucGiao: 0, soChuyen: 0 };
      const soLuongDat = agg.soLuongDat || 0;
      const thucNhan = agg.thucNhan || 0;
      const thucGiao = gh.thucGiao || 0;
      rows.push({
        maDon: o.orderId,
        ncc: o.supplierName || nccMap[o.supplierId] || o.supplierId,
        trangThaiDon: o.status || "",
        ngayDat: dt,
        user: o.createdBy || "",
        soChiTiet: agg.soChiTiet,
        soLuongDat,
        thucNhan,
        thucGiao,
        soChuyenGiao: gh.soChuyen,
        tyLeNhan:
          soLuongDat > 0
            ? Math.round((thucNhan / soLuongDat) * 1000) / 10
            : 0,
        tyLeGiao:
          thucNhan > 0 ? Math.round((thucGiao / thucNhan) * 1000) / 10 : 0,
      });
    }
    return rows;
  }
}