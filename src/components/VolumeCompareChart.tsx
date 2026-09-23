"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  VolumeCompareResult,
  VolumeMode,
  VolumeMetric,
  VolumeGroupBy,
} from "@/mocks/volume";

function fmt(n: number) {
  return n.toLocaleString("vi-VN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export function VolumeCompareChart() {
  const [mode, setMode] = useState<VolumeMode>("ytd");
  const [metric, setMetric] = useState<VolumeMetric>("receiving");
  const [groupBy, setGroupBy] = useState<VolumeGroupBy>("phanloai");
  const year = new Date().getFullYear();
  const [data, setData] = useState<VolumeCompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/v1/reports/volume-compare?mode=${mode}&metric=${metric}&groupBy=${groupBy}&year=${year}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải biểu đồ");
        setData(null);
        return;
      }
      // normalize: API may put meta inside data
      const d = json.data;
      setData({
        ...d,
        meta: d.meta || json.meta || {},
      } as VolumeCompareResult);
    } catch {
      setErr("Không kết nối API");
    } finally {
      setLoading(false);
    }
  }, [mode, metric, groupBy, year]);

  useEffect(() => {
    load();
  }, [load]);

  const series = data?.series || [];
  const totals = useMemo(() => {
    return series.reduce(
      (a, s) => ({
        current: a.current + (s.current || 0),
        previous: a.previous + (s.previous || 0),
      }),
      { current: 0, previous: 0 }
    );
  }, [series]);

  const maxVal = Math.max(
    1,
    ...series.map((s) => Math.max(s.current || 0, s.previous || 0))
  );

  const periodNote =
    (data as { meta?: { periodNote?: string } })?.meta?.periodNote ||
    data?.meta?.periodNote ||
    "";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-800 text-sm">
            So sánh sản lượng
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {periodNote || "Cùng kỳ năm / tháng"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["ytd", "Cùng kỳ năm"],
              ["mom", "Tháng này/trước"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border ${
                mode === k
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white border-slate-200"
              }`}
            >
              {l}
            </button>
          ))}
          {(
            [
              ["receiving", "Thực nhận"],
              ["delivery", "Thực giao"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border ${
                metric === k
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white border-slate-200"
              }`}
            >
              {l}
            </button>
          ))}
          {(
            [
              ["phanloai", "Bao/Rời"],
              ["supplier", "Theo NCC"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setGroupBy(k)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border ${
                groupBy === k
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white border-slate-200"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tổng rõ số */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
          <div className="text-[10px] uppercase text-blue-600 font-semibold">
            Kỳ này (tấn)
          </div>
          <div className="text-lg font-bold text-blue-900 tabular-nums">
            {fmt(totals.current)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">
            Cùng kỳ trước (tấn)
          </div>
          <div className="text-lg font-bold text-slate-800 tabular-nums">
            {fmt(totals.previous)}
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center text-slate-400 text-sm py-8">Đang tải…</div>
      )}
      {err && (
        <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{err}</div>
      )}

      {!loading && !err && (
        <div className="space-y-3">
          {series.map((s) => (
            <div key={s.label} className="space-y-1">
              <div className="flex justify-between text-xs text-slate-600">
                <span className="font-medium truncate">{s.label}</span>
                <span className="tabular-nums text-slate-500">
                  {fmt(s.current)} / {fmt(s.previous)}
                </span>
              </div>
              {/* current bar */}
              <div className="relative h-6 bg-slate-100 rounded overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-blue-500 rounded flex items-center justify-end pr-1.5 min-w-0"
                  style={{
                    width: `${Math.max(2, (s.current / maxVal) * 100)}%`,
                  }}
                >
                  {s.current > 0 && (
                    <span className="text-[10px] font-bold text-white tabular-nums drop-shadow">
                      {fmt(s.current)}
                    </span>
                  )}
                </div>
              </div>
              {/* previous bar */}
              <div className="relative h-5 bg-slate-50 rounded overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-slate-400/80 rounded flex items-center justify-end pr-1.5"
                  style={{
                    width: `${Math.max(2, (s.previous / maxVal) * 100)}%`,
                  }}
                >
                  {s.previous > 0 && (
                    <span className="text-[10px] font-semibold text-white tabular-nums">
                      {fmt(s.previous)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!series.length && (
            <div className="text-center text-slate-400 text-sm py-6">
              Không có dữ liệu kỳ này
            </div>
          )}
          <div className="flex gap-4 text-[10px] text-slate-500 pt-1">
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-2 rounded bg-blue-500" /> Kỳ này
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-2 rounded bg-slate-400" /> Cùng kỳ trước
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
