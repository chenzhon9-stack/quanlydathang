"use client";

import { MOCK_DELIVERIES_2026, MOCK_DETAILS_2026 } from "@/mocks/data";

export default function DeliveriesPage() {
  const deliveries = MOCK_DELIVERIES_2026.filter((d) => !d.deleted);

  function actionLabel(detailId: string): string {
    const detail = MOCK_DETAILS_2026.find((d) => d.detailId === detailId);
    if (!detail) return "Xem";
    if (detail.status === "NEW" || detail.status === "ORDERED") return "Sửa";
    if (detail.status === "RECEIVED" || detail.status === "DELIVERING") return "Giao";
    return "Xem";
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Giao hàng</h2>
          <p className="text-xs text-slate-500">{deliveries.length} lượt</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => alert("[Mock] Tùy chỉnh cột")} className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200 text-slate-700">
            Tùy chỉnh cột
          </button>
          <button onClick={() => alert("[Mock] Xuất Excel")} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white">
            Xuất Excel
          </button>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {deliveries.map((d) => (
          <div key={d.deliveryId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">{d.customerName || d.customerId}</div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">{d.deliveryId}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-emerald-600">{d.actualQty?.toFixed(2) ?? "—"}</div>
                <div className="text-[10px] text-slate-400">thực giao</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <div><div className="text-xs text-slate-500">Chi tiết</div><div className="font-medium text-blue-700 text-xs font-mono">{d.detailId}</div></div>
              <div><div className="text-xs text-slate-500">Ngày giao</div><div className="font-medium">{d.deliveryDate || "—"}</div></div>
              <div><div className="text-xs text-slate-500">Kế hoạch</div><div className="font-medium">{d.plannedQty.toFixed(2)}</div></div>
              <div><div className="text-xs text-slate-500">Chênh lệch</div><div className="font-medium">{d.actualQty != null ? (d.actualQty - d.plannedQty).toFixed(2) : "—"}</div></div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => alert(`[Mock] ${actionLabel(d.detailId)} — ${d.deliveryId}`)}
                className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-600 text-white"
              >
                {actionLabel(d.detailId)}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
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
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.deliveryId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-xs">{d.deliveryId}</td>
                  <td className="px-3 py-2.5 text-blue-700 text-xs font-mono">{d.detailId}</td>
                  <td className="px-3 py-2.5 font-medium">{d.customerName || d.customerId}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.plannedQty.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">{d.actualQty?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{d.deliveryDate || "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => alert(`[Mock] ${actionLabel(d.detailId)} — ${d.deliveryId}`)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
                    >
                      {actionLabel(d.detailId)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
