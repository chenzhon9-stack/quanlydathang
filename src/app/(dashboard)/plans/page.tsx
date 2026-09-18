"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_PLANS_2026 } from "@/mocks/data";

const STATUS_ROW: Record<string, string> = {
  "Đang thực hiện": "bg-sky-50 hover:bg-sky-100/70",
  "Hoàn tất": "bg-emerald-50 hover:bg-emerald-100/70",
  Hủy: "bg-red-50 hover:bg-red-100/70",
};

export default function PlansPage() {
  const plans = MOCK_PLANS_2026;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Kế hoạch sản lượng</h2>
        <span className="text-xs text-slate-500">{plans.length} KH</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-blue-600 text-white text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-semibold">Mã KH</th>
                <th className="px-3 py-2.5 text-left font-semibold">Chương trình</th>
                <th className="px-3 py-2.5 text-left font-semibold">NCC</th>
                <th className="px-3 py-2.5 text-right font-semibold">Kế hoạch</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thực hiện</th>
                <th className="px-3 py-2.5 text-center font-semibold">%</th>
                <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const percent =
                  p.plannedQuantity > 0
                    ? Math.min(
                        100,
                        Math.round((p.actualQuantity / p.plannedQuantity) * 100)
                      )
                    : 0;

                return (
                  <tr
                    key={p.id}
                    className={`border-t border-slate-100 transition ${
                      STATUS_ROW[p.status] || "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-blue-700 font-medium">
                      {p.id}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[160px] truncate">
                      {p.programName}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[140px] truncate">
                      {p.supplierName || p.supplierId}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                      {p.plannedQuantity.toLocaleString("vi-VN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                      {p.actualQuantity.toLocaleString("vi-VN", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-slate-700 w-8">
                          {percent}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 text-center md:hidden">
        Vuốt ngang để xem đủ cột
      </p>
    </div>
  );
}
