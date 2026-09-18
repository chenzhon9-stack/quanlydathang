"use client";

import { MOCK_DELIVERIES_2026 } from "@/mocks/data";

export default function DeliveriesPage() {
  const deliveries = MOCK_DELIVERIES_2026.filter((d) => !d.deleted);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Giao hàng</h2>
        <span className="text-xs text-slate-500">{deliveries.length} lượt</span>
      </div>

      <div className="space-y-3">
        {deliveries.map((d) => (
          <div
            key={d.deliveryId}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  {d.customerName || d.customerId}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 font-mono">
                  {d.deliveryId}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-emerald-600">
                  {d.actualQty?.toFixed(2) ?? "—"}
                </div>
                <div className="text-[10px] text-slate-400">thực giao</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div>
                <div className="text-xs text-slate-500">Chi tiết</div>
                <div className="font-medium text-blue-700 text-xs font-mono">
                  {d.detailId}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Ngày giao</div>
                <div className="font-medium">{d.deliveryDate || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Kế hoạch</div>
                <div className="font-medium">{d.plannedQty.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Chênh lệch</div>
                <div className="font-medium">
                  {d.actualQty != null
                    ? (d.actualQty - d.plannedQty).toFixed(2)
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
