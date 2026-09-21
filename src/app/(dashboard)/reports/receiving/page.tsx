"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { ReportSubNav } from "@/components/ReportSubNav";

export default function ReceivingReportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      const role = String(u.role || "").toUpperCase();
      if (["SALES", "VIEWER", "ACCOUNTANT"].includes(role)) {
        router.replace("/reports/thuc-giao");
        return;
      }
    } catch { /* ignore */ }
    setLoading(true);
    fetch(`/api/v1/reports/receiving?year=${year}&pageSize=100`, {
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
          <p className="text-xs text-slate-500">Thực nhận · {meta?.total ?? 0} dòng</p>
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
            onClick={() => alert("[Mock] Xuất CSV — exportDynamicReportCsv()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white"
          >
            Xuất CSV
          </button>
          <button
            onClick={() => alert("[Mock] Tùy chỉnh cột — openColumnCustomizer()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tùy chỉnh cột
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
                  <th className="px-3 py-2.5 text-left font-semibold">Mã CT</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Đơn</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Hàng hóa</th>
                  <th className="px-3 py-2.5 text-right font-semibold">KH</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Thực nhận</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Ngày nhận</th>
                  <th className="px-3 py-2.5 text-left font-semibold">TT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.detailId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{r.detailId}</td>
                    <td className="px-3 py-2.5 text-blue-700 text-xs font-medium">{r.orderId}</td>
                    <td className="px-3 py-2.5 font-medium">{r.productName || r.productId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.quantity?.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                      {r.actualReceived?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.receivedDate || "—"}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
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
