"use client";

import { useEffect, useMemo, useState } from "react";
import type { VolumeCompareResult, VolumeMode, VolumeMetric } from "@/mocks/volume";

export function VolumeCompareChart() {
  const [mode, setMode] = useState<VolumeMode>("ytd");
  const [metric, setMetric] = useState<VolumeMetric>("receiving");
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
    fetch(
      `/api/v1/reports/volume-compare?mode=${mode}&metric=${metric}&year=2026`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, [mode, metric]);

  const series = useMemo(
    () => (data?.series || []).filter((s) => enabled[s.label]),
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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">So sánh sản lượng</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {mode === "ytd" ? "YTD năm nay vs cùng kỳ năm trước" : "Tháng này vs tháng trước"}
            {" · "}
            {metric === "receiving" ? "Thực nhận" : "Thực giao"}
            {" · "}
            Biểu đồ cột
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setMode("ytd")}
              className={`px-2.5 py-1.5 ${mode === "ytd" ? "bg-blue-600 text-white" : "bg-white text-slate-600"}`}
            >
              YTD
            </button>
            <button
              onClick={() => setMode("mom")}
              className={`px-2.5 py-1.5 ${mode === "mom" ? "bg-blue-600 text-white" : "bg-white text-slate-600"}`}
            >
              MoM
            </button>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              onClick={() => setMetric("receiving")}
              className={`px-2.5 py-1.5 ${metric === "receiving" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}
            >
              Thực nhận
            </button>
            <button
              onClick={() => setMetric("delivery")}
              className={`px-2.5 py-1.5 ${metric === "delivery" ? "bg-slate-800 text-white" : "bg-white text-slate-600"}`}
            >
              Thực giao
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-xs">
        {(["Bao", "Roi", "Khac"] as const).map((k) => (
          <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled[k]}
              onChange={() => setEnabled((e) => ({ ...e, [k]: !e[k] }))}
              className="rounded border-slate-300"
            />
            {labelMap[k]}
          </label>
        ))}
        <span className="ml-auto flex items-center gap-3 text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Hiện tại
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" /> Kỳ trước
          </span>
        </span>
      </div>

      {loading ? (
        <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
          Đang tải biểu đồ...
        </div>
      ) : series.length === 0 ? (
        <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
          Không có dữ liệu
        </div>
      ) : (
        <>
          {/* Column chart */}
          <div className="relative h-56 md:h-64 border-b border-l border-slate-200 pl-1">
            {/* grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="border-t border-slate-100 w-full" />
              ))}
            </div>
            <div className="relative h-full flex items-end justify-around gap-2 px-2 md:px-6">
              {series.map((s) => (
                <div key={s.label} className="flex-1 max-w-[120px] h-full flex flex-col justify-end items-center gap-1">
                  <div className="w-full flex-1 flex items-end justify-center gap-1.5 md:gap-2 min-h-0">
                    {/* previous */}
                    <div className="w-[36%] max-w-[36px] h-full flex flex-col justify-end items-center group">
                      <span className="text-[9px] text-slate-400 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {fmt(s.previous)}
                      </span>
                      <div
                        className="w-full rounded-t-md bg-slate-300 hover:bg-slate-400 transition-colors min-h-[2px]"
                        style={{ height: barH(s.previous) }}
                        title={`Kỳ trước: ${fmt(s.previous)}`}
                      />
                    </div>
                    {/* current */}
                    <div className="w-[36%] max-w-[36px] h-full flex flex-col justify-end items-center group">
                      <span className="text-[9px] text-blue-600 font-medium mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {fmt(s.current)}
                      </span>
                      <div
                        className="w-full rounded-t-md bg-blue-500 hover:bg-blue-600 transition-colors min-h-[2px]"
                        style={{ height: barH(s.current) }}
                        title={`Hiện tại: ${fmt(s.current)}`}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-700 pt-1">
                    {labelMap[s.label] || s.label}
                  </div>
                  <div
                    className={`text-[10px] font-medium ${
                      s.current >= s.previous ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {delta(s.current, s.previous)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary table */}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left py-1.5 font-medium">Loại</th>
                  <th className="text-right py-1.5 font-medium">Hiện tại</th>
                  <th className="text-right py-1.5 font-medium">Kỳ trước</th>
                  <th className="text-right py-1.5 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.label} className="border-b border-slate-50">
                    <td className="py-1.5 font-medium text-slate-700">
                      {labelMap[s.label] || s.label}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-blue-700 font-semibold">
                      {fmt(s.current)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">
                      {fmt(s.previous)}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        s.current >= s.previous ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {delta(s.current, s.previous)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
