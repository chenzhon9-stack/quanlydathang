import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope, hasPermission } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { ReportRepository } from "@/repositories/report.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { filterBySupplierIds, resolveAllowedSupplierIds } from "@/lib/scope";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import type { VolumeMode, VolumeMetric, VolumeSeriesItem } from "@/mocks/volume";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function classifyPhanLoai(raw: string): "Bao" | "Roi" | "Khac" {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi" || s === "roi") return "Roi";
  return "Khac";
}

export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    // Dashboard volume: ADMIN + MANAGER only (user requirement)
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
    const year = searchParams.get("year")
      ? Number(searchParams.get("year"))
      : new Date().getFullYear();

    if (mode !== "ytd" && mode !== "mom") {
      return jsonResponse(error("VALIDATION_ERROR", "mode ytd|mom"), 400);
    }
    if (metric !== "receiving" && metric !== "delivery") {
      return jsonResponse(error("VALIDATION_ERROR", "metric receiving|delivery"), 400);
    }

    const now = new Date();
    const scope = resolveScope(user);

    // HH map MaHH → PhanLoai
    let phanLoaiMap: Record<string, string> = {};
    if (isSheetsConfigured()) {
      try {
        const hhRows = await readSheetAsObjects(SHEETS.HH, {});
        for (const r of hhRows) {
          const ma = String(r.MaHH || "").trim();
          if (ma) phanLoaiMap[ma] = String(r.PhanLoaiHH || "");
        }
      } catch (e) {
        console.error("[volume] HH map", e);
      }
    }

    const buckets = () =>
      ({
        Bao: { current: 0, previous: 0 },
        Roi: { current: 0, previous: 0 },
        Khac: { current: 0, previous: 0 },
      }) as Record<"Bao" | "Roi" | "Khac", { current: number; previous: number }>;

    const agg = buckets();
    let currentFrom = "";
    let currentTo = "";
    let previousFrom = "";
    let previousTo = "";

    if (metric === "receiving") {
      let details = await ReportRepository.getDetails(year);
      // also previous year for ytd
      let prevDetails =
        mode === "ytd"
          ? await ReportRepository.getDetails(year - 1)
          : details;

      if (scope.scopeType === "MANAGEMENT") {
        const allowed = await resolveAllowedSupplierIds(scope);
        details = filterBySupplierIds(details, allowed);
        prevDetails = filterBySupplierIds(prevDetails, allowed);
      }

      if (mode === "ytd") {
        currentFrom = `${year}-01-01`;
        currentTo = ymd(now);
        previousFrom = `${year - 1}-01-01`;
        previousTo = `${year - 1}-12-31`;
        const inRange = (d: string, a: string, b: string) =>
          d && d >= a && d <= b;
        for (const d of details) {
          const qty = d.actualReceived || 0;
          if (qty <= 0) continue;
          const dt = d.receivedDate || d.orderDate || "";
          if (!inRange(dt, currentFrom, currentTo)) continue;
          const pl = classifyPhanLoai(
            d.phanLoai || phanLoaiMap[d.productId] || ""
          );
          agg[pl].current += qty;
        }
        for (const d of prevDetails) {
          const qty = d.actualReceived || 0;
          if (qty <= 0) continue;
          const dt = d.receivedDate || d.orderDate || "";
          if (!inRange(dt, previousFrom, previousTo)) continue;
          const pl = classifyPhanLoai(
            d.phanLoai || phanLoaiMap[d.productId] || ""
          );
          agg[pl].previous += qty;
        }
      } else {
        // MOM: tháng này vs tháng trước
        const y = now.getFullYear();
        const m = now.getMonth(); // 0-based
        const curStart = new Date(y, m, 1);
        const prevStart = new Date(y, m - 1, 1);
        const prevEnd = new Date(y, m, 0);
        currentFrom = ymd(curStart);
        currentTo = ymd(now);
        previousFrom = ymd(prevStart);
        previousTo = ymd(prevEnd);
        const all = [...details, ...prevDetails];
        for (const d of all) {
          const qty = d.actualReceived || 0;
          if (qty <= 0) continue;
          const dt = d.receivedDate || d.orderDate || "";
          const pl = classifyPhanLoai(
            d.phanLoai || phanLoaiMap[d.productId] || ""
          );
          if (dt >= currentFrom && dt <= currentTo) agg[pl].current += qty;
          else if (dt >= previousFrom && dt <= previousTo)
            agg[pl].previous += qty;
        }
      }
    } else {
      // delivery metric — sum actualQty; join detail for productId if needed
      let dels = await ReportRepository.getDeliveries(year);
      let prevDels =
        mode === "ytd"
          ? await ReportRepository.getDeliveries(year - 1)
          : dels;
      dels = dels.filter((d) => !d.deleted && (d.actualQty || 0) > 0);
      prevDels = prevDels.filter((d) => !d.deleted && (d.actualQty || 0) > 0);

      // Map detailId → product for phan loại
      const details = await ReportRepository.getDetails(year);
      const prevDet =
        mode === "ytd"
          ? await ReportRepository.getDetails(year - 1)
          : details;
      const detMap: Record<string, string> = {};
      for (const d of [...details, ...prevDet]) {
        detMap[d.detailId] = d.productId;
      }

      if (mode === "ytd") {
        currentFrom = `${year}-01-01`;
        currentTo = ymd(now);
        previousFrom = `${year - 1}-01-01`;
        previousTo = `${year - 1}-12-31`;
        for (const d of dels) {
          const dt = d.deliveryDate || "";
          if (!dt || dt < currentFrom || dt > currentTo) continue;
          const pid = detMap[d.detailId] || "";
          const pl = classifyPhanLoai(phanLoaiMap[pid] || "");
          agg[pl].current += d.actualQty || 0;
        }
        for (const d of prevDels) {
          const dt = d.deliveryDate || "";
          if (!dt || dt < previousFrom || dt > previousTo) continue;
          const pid = detMap[d.detailId] || "";
          const pl = classifyPhanLoai(phanLoaiMap[pid] || "");
          agg[pl].previous += d.actualQty || 0;
        }
      } else {
        const y = now.getFullYear();
        const m = now.getMonth();
        currentFrom = ymd(new Date(y, m, 1));
        currentTo = ymd(now);
        previousFrom = ymd(new Date(y, m - 1, 1));
        previousTo = ymd(new Date(y, m, 0));
        for (const d of [...dels, ...prevDels]) {
          const dt = d.deliveryDate || "";
          const pid = detMap[d.detailId] || "";
          const pl = classifyPhanLoai(phanLoaiMap[pid] || "");
          const qty = d.actualQty || 0;
          if (dt >= currentFrom && dt <= currentTo) agg[pl].current += qty;
          else if (dt >= previousFrom && dt <= previousTo)
            agg[pl].previous += qty;
        }
      }
    }

    const series: VolumeSeriesItem[] = (
      ["Bao", "Roi", "Khac"] as const
    ).map((label) => ({
      label,
      current: Math.round(agg[label].current * 1000) / 1000,
      previous: Math.round(agg[label].previous * 1000) / 1000,
    }));

    return jsonResponse(
      success(
        {
          mode,
          metric,
          year,
          series,
          meta: { currentFrom, currentTo, previousFrom, previousTo },
        },
        { source: "sheets", generatedAt: new Date().toISOString() }
      )
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
