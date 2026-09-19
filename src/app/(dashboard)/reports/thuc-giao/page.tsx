"use client";

import { useEffect, useState } from "react";
import { ReportSubNav } from "@/components/ReportSubNav";

export default function ThucGiaoReportPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    fetch(`/api/v1/reports/deliveries?year=${year}&pageSize=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setRows(json.data || []);
          setMeta(json.meta);
        }
      })
      .finally(() => setLoading(false));
  }, [year]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Báo cáo</h2>
          <p className="text-xs text-slate-500">Thực giao · {meta?.total ?? 0} dòng</p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white"
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
          </select>
          <button
            onClick={() => alert("[Mock] Xuất CSV")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white"
          >
            Xuất CSV
          </button>
        </div>
      </div>

      <ReportSubNav />

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left font-semibold">Mã GH</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Chi tiết</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                  <th className="px-3 py-2.5 text-right font-semibold">KH</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Thực giao</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ngày giao</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.deliveryId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs">{r.deliveryId}</td>
                    <td className="px-3 py-2.5 text-blue-700 text-xs font-mono">{r.detailId}</td>
                    <td className="px-3 py-2.5 font-medium">{r.customerName || r.customerId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.plannedQty?.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                      {r.actualQty?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.deliveryDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">Không có dữ liệu</div>
          )}
        </div>
      )}
    </div>
  );
}
