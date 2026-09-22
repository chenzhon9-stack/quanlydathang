"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  VolumeCompareResult,
  VolumeMode,
  VolumeMetric,
  VolumeGroupBy,
} from "@/mocks/volume";

export function VolumeCompareChart() {
  const [mode, setMode] = useState<VolumeMode>("ytd");
  const [metric, setMetric] = useState<VolumeMetric>("receiving");
  const [groupBy, setGroupBy] = useState<VolumeGroupBy>("phanloai");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    Bao: true,
    Roi: true,
    Khac: true,
  });
  const [data, setData] = useState<VolumeCompareResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    const year = new Date().getFullYear();
    fetch(
      `/api/v1/reports/volume-compare?mode=${mode}&metric=${metric}&groupBy=${groupBy}&year=${year}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setData(json.data);
          if (json.data.groupBy === "supplier") {
            const en: Record<string, boolean> = {};
            (json.data.series || []).forEach(
              (s: { label: string }) => (en[s.label] = true)
            );
            setEnabled(en);
          } else {
            setEnabled({ Bao: true, Roi: true, Khac: true });
          }
        }
      })
      .finally(() => setLoading(false));
  }, [mode, metric, groupBy]);

  const series = useMemo(
    () => (data?.series || []).filter((s) => enabled[s.label] !== false),
    [data, enabled]
  );

  const maxVal = useMemo(() => {
    let m = 1;
    series.forEach((s) => {
      m = Math.max(m, s.current, s.previous);
    });
    return m;
  }, [series]);

  function barH(v: number) {
    return `${Math.max(2, Math.round((v / maxVal) * 100))}%`;
  }

  function fmt(n: number) {
    return n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  }

  function delta(cur: number, prev: number) {
    if (!prev) return "—";
    const d = ((cur - prev) / prev) * 100;
    const sign = d >= 0 ? "+" : "";
    return `${sign}${d.toFixed(1)}%`;
  }

  const labelMap: Record<string, string> = {
    Bao: "Bao",
    Roi: "Rời",
    Khac: "Khác",
  };

  const periodNote = data?.meta?.periodNote || "";

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">So sánh sản lượng</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {periodNote ||
              (mode === "ytd"
                ? "Cùng kỳ đầu năm → hôm qua"
                : "Cùng kỳ tháng (đến hôm qua)")}
          </p>
          {data?.meta && (
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Hiện tại: {data.meta.currentFrom} → {data.meta.currentTo}
              <br />
              Cùng kỳ: {data.meta.previousFrom} → {data.meta.previousTo}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMode("ytd")}
              className={`px-3 py-1.5 font-medium ${
                mode === "ytd"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Cùng kỳ năm
            </button>
            <button
              type="button"
              onClick={() => setMode("mom")}
              className={`px-3 py-1.5 font-medium ${
                mode === "mom"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Tháng này / trước
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMetric("receiving")}
              className={`px-3 py-1.5 font-medium ${
                metric === "receiving"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Thực nhận
            </button>
            <button
              type="button"
              onClick={() => setMetric("delivery")}
              className={`px-3 py-1.5 font-medium ${
                metric === "delivery"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Thực giao
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setGroupBy("phanloai")}
              className={`px-3 py-1.5 font-medium ${
                groupBy === "phanloai"
                  ? "bg-violet-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Bao / Rời
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("supplier")}
              className={`px-3 py-1.5 font-medium ${
                groupBy === "supplier"
                  ? "bg-violet-600 text-white"
                  : "bg-white text-slate-600"
              }`}
            >
              Theo NCC
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>
      ) : !series.length ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Không có dữ liệu trong khoảng thời gian
        </div>
      ) : (
        <>
          {groupBy === "phanloai" && (
            <div className="flex flex-wrap gap-3 mb-3 text-xs text-slate-600">
              {(["Bao", "Roi", "Khac"] as const).map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5 select-none">
                  <input
                    type="checkbox"
                    checked={enabled[k] !== false}
                    onChange={() =>
                      setEnabled((e) => ({ ...e, [k]: !e[k] }))
                    }
                    className="rounded border-slate-300"
                  />
                  {labelMap[k]}
                </label>
              ))}
            </div>
          )}

          <div
            className={`flex items-end gap-2 md:gap-4 h-48 md:h-56 ${
              groupBy === "supplier" ? "overflow-x-auto pb-2" : ""
            }`}
          >
            {series.map((s) => (
              <div
                key={s.id || s.label}
                className={`flex-1 flex flex-col items-center gap-1 min-w-0 ${
                  groupBy === "supplier" ? "min-w-[72px] flex-none" : ""
                }`}
              >
                <div className="flex items-end justify-center gap-1 h-40 w-full max-w-[80px] mx-auto">
                  <div
                    className="w-5 md:w-6 rounded-t bg-slate-300 relative group"
                    style={{ height: barH(s.previous) }}
                    title={`Cùng kỳ: ${fmt(s.previous)}`}
                  />
                  <div
                    className="w-5 md:w-6 rounded-t bg-blue-500 relative group"
                    style={{ height: barH(s.current) }}
                    title={`Hiện tại: ${fmt(s.current)}`}
                  />
                </div>
                <div
                  className="text-[10px] md:text-xs font-medium text-slate-700 text-center truncate w-full px-0.5"
                  title={s.label}
                >
                  {labelMap[s.label] || s.label}
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  {fmt(s.current)}
                </div>
                <div
                  className={`text-[10px] font-medium tabular-nums ${
                    s.current >= s.previous ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {delta(s.current, s.previous)}
                </div>
                {mode === "ytd" && s.previousFullYear != null && (
                  <div
                    className="text-[9px] text-slate-400 tabular-nums"
                    title="Tổng cả năm trước"
                  >
                    Cả năm trước: {fmt(s.previousFullYear)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-4 mt-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-500" /> Hiện tại (cùng kỳ)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-slate-300" /> Cùng kỳ năm/tháng trước
            </span>
          </div>
        </>
      )}
    </div>
  );
}
