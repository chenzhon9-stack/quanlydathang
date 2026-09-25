import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope, hasPermission } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { ReportBuilderService } from "@/services/report-builder.service";
import type {
  VolumeMode,
  VolumeMetric,
  VolumeGroupBy,
  VolumeSeriesItem,
} from "@/mocks/volume";
import {
  todayYmdVN,
  addDaysYmd,
  currentYearVN,
} from "@/lib/sheets/date";

function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Cùng kỳ:
 * - YTD: 1/1 → hôm qua (năm nay) vs 1/1 → cùng ngày tháng năm trước
 * - MOM: 1/tháng → hôm qua vs 1/tháng trước → cùng số ngày (cắt nếu tháng ngắn hơn)
 */
function resolvePeriods(mode: VolumeMode, yearHint?: number) {
  const today = todayYmdVN();
  const yesterday = addDaysYmd(today, -1);
  const { y: cy, m: cm, d: cd } = parseYmd(yesterday);

  if (mode === "ytd") {
    const year = yearHint && yearHint > 2000 ? yearHint : cy; // cy từ yesterday HCM
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


/** Chuẩn hóa nhãn phân loại để ghép series */
function normPhanLoaiLabel(raw: unknown): "Bao" | "Roi" | "Khac" {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi" || s.startsWith("roi")) return "Roi";
  return "Khac";
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
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
    // Sau check null ở trên — narrow type cho closure
    const authedUser = user!;
    const scope = resolveScope(authedUser);

    // Dùng đúng pipeline báo cáo → không lệch số với tab Thực nhận / Thực giao
    const reportType = metric === "receiving" ? "thuc_nhan" : "thuc_giao";
    const measureKey = metric === "receiving" ? "thucNhan" : "thucGiao";
    const dimKey =
      groupBy === "supplier"
        ? metric === "receiving"
          ? "ncc"
          : "khachHang"
        : "phanLoai";

    async function loadPeriod(fromDate: string, toDate: string) {
      const res = await ReportBuilderService.run(
        reportType,
        {
          fromDate,
          toDate,
          groupBy: [dimKey],
          page: 1,
          pageSize: 500,
        },
        authedUser,
        scope
      );
      return res.items as Record<string, unknown>[];
    }

    const [curItems, prevItems, prevFullItems] = await Promise.all([
      loadPeriod(periods.currentFrom, periods.currentTo),
      loadPeriod(periods.previousFrom, periods.previousTo),
      mode === "ytd"
        ? loadPeriod(periods.previousFullFrom, periods.previousFullTo)
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);

    type Bucket = { current: number; previous: number; previousFullYear: number };
    const map = new Map<string, Bucket>();

    function bump(key: string, field: keyof Bucket, qty: number) {
      if (!key) return;
      if (!map.has(key))
        map.set(key, { current: 0, previous: 0, previousFullYear: 0 });
      map.get(key)![field] += qty;
    }

    function rowKey(row: Record<string, unknown>): string {
      if (groupBy === "supplier") {
        return String(row[dimKey] ?? row.MaNCC ?? row.ncc ?? "UNKNOWN");
      }
      return normPhanLoaiLabel(row.phanLoai ?? row[dimKey]);
    }

    for (const row of curItems) {
      const k = rowKey(row);
      if (groupBy === "phanloai" && k === "Khac") continue;
      bump(k, "current", Number(row[measureKey]) || 0);
    }
    for (const row of prevItems) {
      const k = rowKey(row);
      if (groupBy === "phanloai" && k === "Khac") continue;
      bump(k, "previous", Number(row[measureKey]) || 0);
    }
    for (const row of prevFullItems) {
      const k = rowKey(row);
      if (groupBy === "phanloai" && k === "Khac") continue;
      bump(k, "previousFullYear", Number(row[measureKey]) || 0);
    }

    let series: VolumeSeriesItem[] = [];
    if (groupBy === "phanloai") {
      for (const label of ["Bao", "Roi"] as const) {
        const b = map.get(label) || {
          current: 0,
          previous: 0,
          previousFullYear: 0,
        };
        series.push({
          label: label === "Roi" ? "Rời" : label,
          current: round3(b.current),
          previous: round3(b.previous),
          previousFullYear:
            mode === "ytd" ? round3(b.previousFullYear) : undefined,
        });
      }
    } else {
      series = Array.from(map.entries())
        .map(([id, b]) => ({
          label: id,
          id,
          current: round3(b.current),
          previous: round3(b.previous),
          previousFullYear:
            mode === "ytd" ? round3(b.previousFullYear) : undefined,
        }))
        .filter((s) => s.current > 0 || s.previous > 0)
        .sort((a, b) => b.current - a.current)
        .slice(0, 12);
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
            current: round3(totals.current),
            previous: round3(totals.previous),
          },
          meta: {
            currentFrom: periods.currentFrom,
            currentTo: periods.currentTo,
            previousFrom: periods.previousFrom,
            previousTo: periods.previousTo,
            periodNote: periods.periodNote,
            source: `ReportBuilderService.${reportType}`,
            phanLoaiScope: "Bao+Rời (loại Khác không tính trên dashboard)",
          },
        },
        {
          currentFrom: periods.currentFrom,
          currentTo: periods.currentTo,
          previousFrom: periods.previousFrom,
          previousTo: periods.previousTo,
        }
      )
    );
  } catch (e) {
    console.error("[volume-compare]", e);
    const err = e as { code?: string; message?: string };
    return jsonResponse(
      error(err.code || "INTERNAL", err.message || "Lỗi so sánh sản lượng"),
      err.code === "PERMISSION_DENIED" ? 403 : 500
    );
  }
}
