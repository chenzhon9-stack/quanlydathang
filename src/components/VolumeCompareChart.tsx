"use client";

import { useEffect, useMemo, useState } from "react";
import type { VolumeCompareResult, VolumeMode, VolumeMetric } from "@/mocks/volume";

const COLORS = {
  current: "bg-blue-500",
  previous: "bg-slate-300",
  bao: "text-blue-700",
  roi: "text-violet-700",
  khac: "text-amber-700",
};

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

  function pct(v: number) {
    return Math.round((v / maxVal) * 100);
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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">
            So sánh sản lượng
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {mode === "ytd"
              ? "YTD năm nay vs cùng kỳ năm trước"
              : "Tháng này vs tháng trước"}
            {" · "}
            {metric === "receiving" ? "Thực nhận" : "Thực giao"}
            {" · "}
            Phân loại Bao / Rời / Khác
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as VolumeMode)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="ytd">YTD vs năm trước</option>
            <option value="mom">Tháng này vs tháng trước</option>
          </select>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as VolumeMetric)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="receiving">Thực nhận</option>
            <option value="delivery">Thực giao</option>
          </select>
        </div>
      </div>

      {/* Toggle phân loại */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["Bao", "Roi", "Khac"] as const).map((lab) => (
          <button
            key={lab}
            type="button"
            onClick={() =>
              setEnabled((prev) => ({ ...prev, [lab]: !prev[lab] }))
            }
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
              enabled[lab]
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-400 border-slate-200"
            }`}
          >
            {lab === "Roi" ? "Rời" : lab === "Khac" ? "Khác" : "Bao"}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
          Đang tải biểu đồ...
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {series.map((s) => (
              <div key={s.label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700">
                    {s.label === "Roi" ? "Rời" : s.label === "Khac" ? "Khác" : "Bao"}
                  </span>
                  <span
                    className={`font-medium ${
                      s.current >= s.previous
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    {delta(s.current, s.previous)}
                  </span>
                </div>
                {/* Current */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-14 text-[10px] text-slate-500 shrink-0">
                    Hiện tại
                  </span>
                  <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${COLORS.current} rounded-md transition-all duration-500 flex items-center justify-end pr-2`}
                      style={{ width: `${Math.max(pct(s.current), 8)}%` }}
                    >
                      <span className="text-[10px] text-white font-medium">
                        {fmt(s.current)}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Previous */}
                <div className="flex items-center gap-2">
                  <span className="w-14 text-[10px] text-slate-500 shrink-0">
                    Kỳ trước
                  </span>
                  <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`h-full ${COLORS.previous} rounded-md transition-all duration-500 flex items-center justify-end pr-2`}
                      style={{ width: `${Math.max(pct(s.previous), 8)}%` }}
                    >
                      <span className="text-[10px] text-slate-700 font-medium">
                        {fmt(s.previous)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {series.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-8">
              Chọn ít nhất một phân loại để hiển thị
            </p>
          )}

          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-blue-500" /> Hiện tại (
              {data.meta.currentFrom} → {data.meta.currentTo})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-slate-300" /> Kỳ trước (
              {data.meta.previousFrom} → {data.meta.previousTo})
            </span>
          </div>
        </>
      )}
    </div>
  );
}
