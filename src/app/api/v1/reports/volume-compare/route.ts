import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope, hasPermission } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { ReportRepository } from "@/repositories/report.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { isExcludedDetailStatus } from "@/lib/reports/exclude-detail";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import type {
  VolumeMode,
  VolumeMetric,
  VolumeGroupBy,
  VolumeSeriesItem,
} from "@/mocks/volume";

/** Ngày theo TZ Việt Nam YYYY-MM-DD */
function vnYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function addDaysYmd(ymd: string, delta: number): string {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Cùng kỳ:
 * - YTD: 1/1 → hôm qua (năm nay) vs 1/1 → cùng ngày tháng năm trước
 * - MOM: 1/tháng → hôm qua vs 1/tháng trước → cùng số ngày (cắt nếu tháng ngắn hơn)
 */
function resolvePeriods(mode: VolumeMode, yearHint?: number) {
  const today = vnYmd();
  const yesterday = addDaysYmd(today, -1);
  const { y: cy, m: cm, d: cd } = parseYmd(yesterday);

  if (mode === "ytd") {
    const year = yearHint && yearHint > 2000 ? yearHint : cy;
    // Nếu yearHint khác năm của yesterday, vẫn lấy đến 31/12 year hoặc yesterday nếu cùng năm
    let currentTo = yesterday;
    if (year !== cy) {
      currentTo = `${year}-12-31`;
    }
    const currentFrom = `${year}-01-01`;
    const previousFrom = `${year - 1}-01-01`;
    // cùng ngày-tháng năm trước
    const prevD = Math.min(cd, daysInMonth(year - 1, cm));
    const previousTo = `${year - 1}-${String(cm).padStart(2, "0")}-${String(prevD).padStart(2, "0")}`;
    return {
      year,
      currentFrom,
      currentTo,
      previousFrom,
      previousTo,
      previousFullFrom: `${year - 1}-01-01`,
      previousFullTo: `${year - 1}-12-31`,
      periodNote: `Cùng kỳ: ${currentFrom} → ${currentTo}  so với  ${previousFrom} → ${previousTo}`,
    };
  }

  // MOM
  const year = cy;
  const currentFrom = `${cy}-${String(cm).padStart(2, "0")}-01`;
  const currentTo = yesterday;
  // tháng trước
  let py = cy;
  let pm = cm - 1;
  if (pm < 1) {
    pm = 12;
    py = cy - 1;
  }
  const prevDim = daysInMonth(py, pm);
  const prevDay = Math.min(cd, prevDim);
  const previousFrom = `${py}-${String(pm).padStart(2, "0")}-01`;
  const previousTo = `${py}-${String(pm).padStart(2, "0")}-${String(prevDay).padStart(2, "0")}`;
  return {
    year,
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
    previousFullFrom: previousFrom,
    previousFullTo: `${py}-${String(pm).padStart(2, "0")}-${String(prevDim).padStart(2, "0")}`,
    periodNote: `Cùng kỳ tháng: ${currentFrom} → ${currentTo}  so với  ${previousFrom} → ${previousTo}`,
  };
}

function classifyPhanLoai(raw: string): "Bao" | "Roi" | "Khac" {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi") return "Roi";
  return "Khac";
}

function inRange(dt: string, from: string, to: string) {
  return !!dt && dt >= from && dt <= to;
}

export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const role = String(user.role || "").toUpperCase();
    if (role !== "ADMIN" && role !== "MANAGER" && !hasPermission(user, "*")) {
      return jsonResponse(
        error("PERMISSION_DENIED", "Chỉ Admin/Manager xem tổng quan sản lượng"),
        403
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "ytd") as VolumeMode;
    const metric = (searchParams.get("metric") || "receiving") as VolumeMetric;
    const groupBy = (searchParams.get("groupBy") ||
      "phanloai") as VolumeGroupBy;
    const yearParam = searchParams.get("year")
      ? Number(searchParams.get("year"))
      : undefined;

    if (mode !== "ytd" && mode !== "mom") {
      return jsonResponse(error("VALIDATION_ERROR", "mode ytd|mom"), 400);
    }
    if (metric !== "receiving" && metric !== "delivery") {
      return jsonResponse(
        error("VALIDATION_ERROR", "metric receiving|delivery"),
        400
      );
    }
    if (groupBy !== "phanloai" && groupBy !== "supplier") {
      return jsonResponse(
        error("VALIDATION_ERROR", "groupBy phanloai|supplier"),
        400
      );
    }

    const periods = resolvePeriods(mode, yearParam);
    const scope = resolveScope(user);

    // HH map
    let phanLoaiMap: Record<string, string> = {};
    if (isSheetsConfigured()) {
      try {
        const hhRows = await readSheetAsObjects(SHEETS.HH, {});
        for (const r of hhRows) {
          const ma = String(r.MaHH || "").trim();
          if (ma) phanLoaiMap[ma] = String(r.PhanLoaiHH || "");
        }
      } catch (e) {
        console.error("[volume] HH", e);
      }
    }

    type Bucket = {
      current: number;
      previous: number;
      previousFullYear: number;
    };
    const map = new Map<string, Bucket>();

    function bump(key: string, field: keyof Bucket, qty: number) {
      if (!map.has(key))
        map.set(key, { current: 0, previous: 0, previousFullYear: 0 });
      map.get(key)![field] += qty;
    }

    function groupKey(
      productId: string,
      supplierId: string,
      phanLoai?: string
    ): string {
      if (groupBy === "supplier") return supplierId || "UNKNOWN";
      return classifyPhanLoai(phanLoai || phanLoaiMap[productId] || "");
    }

    /** Dashboard chỉ Bao + Rời — loại Khác không đưa vào báo cáo tổng */
    function isMainPhanLoai(
      productId: string,
      phanLoai?: string
    ): boolean {
      const pl = classifyPhanLoai(phanLoai || phanLoaiMap[productId] || "");
      return pl === "Bao" || pl === "Roi";
    }

    // Load 2 năm data for ytd full-year note + periods
    const yearsNeeded = new Set([
      parseYmd(periods.currentFrom).y,
      parseYmd(periods.previousFrom).y,
    ]);
    if (mode === "ytd") yearsNeeded.add(periods.year - 1);

    if (metric === "receiving") {
      let allDetails: Awaited<
        ReturnType<typeof ReportRepository.getDetails>
      > = [];
      for (const y of yearsNeeded) {
        allDetails = allDetails.concat(await ReportRepository.getDetails(y));
      }
      // dedupe by detailId
      const seen = new Set<string>();
      allDetails = allDetails.filter((d) => {
        if (!d.detailId || seen.has(d.detailId)) return false;
        seen.add(d.detailId);
        return true;
      });

      if (scope.scopeType === "MANAGEMENT") {
        const allowed = await resolveAllowedSupplierIds(scope);
        allDetails = filterBySupplierIds(allDetails, allowed);
      }

      for (const d of allDetails) {
        if (isExcludedDetailStatus(d.status)) continue;
        const qty = d.actualReceived || 0;
        if (qty <= 0) continue;
        if (!isMainPhanLoai(d.productId, d.phanLoai)) continue;
        const dt = d.receivedDate || d.orderDate || "";
        const key = groupKey(d.productId, d.supplierId, d.phanLoai);
        if (inRange(dt, periods.currentFrom, periods.currentTo))
          bump(key, "current", qty);
        if (inRange(dt, periods.previousFrom, periods.previousTo))
          bump(key, "previous", qty);
        if (
          mode === "ytd" &&
          inRange(dt, periods.previousFullFrom, periods.previousFullTo)
        )
          bump(key, "previousFullYear", qty);
      }
    } else {
      // delivery
      let allDels: Awaited<
        ReturnType<typeof ReportRepository.getDeliveries>
      > = [];
      let allDet: Awaited<
        ReturnType<typeof ReportRepository.getDetails>
      > = [];
      for (const y of yearsNeeded) {
        allDels = allDels.concat(await ReportRepository.getDeliveries(y));
        allDet = allDet.concat(await ReportRepository.getDetails(y));
      }
      const detMap: Record<
        string,
        { productId: string; supplierId: string; phanLoai?: string }
      > = {};
      for (const d of allDet) {
        detMap[d.detailId] = {
          productId: d.productId,
          supplierId: d.supplierId,
          phanLoai: d.phanLoai,
        };
      }
      // Map status từ CT để loại Hủy/Xóa xe
      const statusByCt: Record<string, string> = {};
      for (const ct of allDet) {
        statusByCt[ct.detailId] = String(ct.status || "");
      }
      allDels = allDels.filter(
        (d) =>
          !d.deleted &&
          (d.actualQty || 0) > 0 &&
          !isExcludedDetailStatus(statusByCt[d.detailId])
      );

      for (const d of allDels) {
        const qty = d.actualQty || 0;
        const meta = detMap[d.detailId];
        if (meta && !isMainPhanLoai(meta.productId, meta.phanLoai)) continue;
        const dt = d.deliveryDate || "";
        const ref = detMap[d.detailId] || { productId: "", supplierId: "" };
        // delivery sheet không có supplier — lấy từ CT
        const key = groupKey(ref.productId, ref.supplierId);
        if (inRange(dt, periods.currentFrom, periods.currentTo))
          bump(key, "current", qty);
        if (inRange(dt, periods.previousFrom, periods.previousTo))
          bump(key, "previous", qty);
        if (
          mode === "ytd" &&
          inRange(dt, periods.previousFullFrom, periods.previousFullTo)
        )
          bump(key, "previousFullYear", qty);
      }
    }

    let series: VolumeSeriesItem[] = [];
    if (groupBy === "phanloai") {
      for (const label of ["Bao", "Roi"] as const) { // Khác không đưa vào dashboard
        const b = map.get(label) || {
          current: 0,
          previous: 0,
          previousFullYear: 0,
        };
        series.push({
          label,
          current: Math.round(b.current * 1000) / 1000,
          previous: Math.round(b.previous * 1000) / 1000,
          previousFullYear:
            mode === "ytd"
              ? Math.round(b.previousFullYear * 1000) / 1000
              : undefined,
        });
      }
    } else {
      const nccNames = await MasterRepository.nccNames();
      series = Array.from(map.entries())
        .map(([id, b]) => ({
          label: nccNames[id] || id,
          id,
          current: Math.round(b.current * 1000) / 1000,
          previous: Math.round(b.previous * 1000) / 1000,
          previousFullYear:
            mode === "ytd"
              ? Math.round(b.previousFullYear * 1000) / 1000
              : undefined,
        }))
        .filter((s) => s.current > 0 || s.previous > 0)
        .sort((a, b) => b.current - a.current)
        .slice(0, 12); // top 12 NCC
    }

    const totals = series.reduce(
      (a, s) => ({
        current: a.current + (s.current || 0),
        previous: a.previous + (s.previous || 0),
      }),
      { current: 0, previous: 0 }
    );

    return jsonResponse(
      success(
        {
          mode,
          metric,
          groupBy,
          year: periods.year,
          series,
          totals: {
            current: Math.round(totals.current * 1000) / 1000,
            previous: Math.round(totals.previous * 1000) / 1000,
          },
          meta: {
            currentFrom: periods.currentFrom,
            currentTo: periods.currentTo,
            previousFrom: periods.previousFrom,
            previousTo: periods.previousTo,
            periodNote: periods.periodNote,
            phanLoaiScope: "Bao+Roi (loại Khác không tính)",
          },
        },
        { source: "sheets", generatedAt: new Date().toISOString() }
      )
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
