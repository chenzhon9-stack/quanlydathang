"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_PLANS_2026 } from "@/mocks/data";
import type { ProductionPlan } from "@/types";

const STATUS_ROW: Record<string, string> = {
  "Đang thực hiện": "bg-sky-50",
  "Hoàn tất": "bg-emerald-50",
  Hủy: "bg-red-50",
};

function PlanActions({ p }: { p: ProductionPlan }) {
  function toast(msg: string) {
    alert(`[Mock] ${msg}\n(${p.id})`);
  }
  const canEdit = p.status !== "Hủy";
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <button onClick={() => toast("Xem chi tiết")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700 hover:bg-slate-300" title="Xem">
        👁 Xem
      </button>
      {canEdit && (
        <>
          <button onClick={() => toast("Sửa kế hoạch")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500" title="Sửa">
            ✎ Sửa
          </button>
          <button onClick={() => toast("Hủy kế hoạch")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white hover:bg-red-400" title="Hủy">
            🗑 Hủy
          </button>
        </>
      )}
    </div>
  );
}

export default function PlansPage() {
  const plans = MOCK_PLANS_2026;

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Kế hoạch sản lượng</h2>
          <p className="text-xs text-slate-500">{plans.length} KH</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => alert("[Mock] Tải lại")} className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200 text-slate-700">
            Tải lại
          </button>
          <button onClick={() => alert("[Mock] Thêm kế hoạch")} className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white">
            + Thêm kế hoạch
          </button>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {plans.map((p) => {
          const percent =
            p.plannedQuantity > 0
              ? Math.min(100, Math.round((p.actualQuantity / p.plannedQuantity) * 100))
              : 0;
          return (
            <div key={p.id} className={`rounded-2xl border border-slate-200 p-4 shadow-sm ${STATUS_ROW[p.status] || "bg-white"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800 truncate">{p.programName}</div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">{p.supplierName || p.supplierId}</div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{p.actualQuantity.toFixed(1)} / {p.plannedQuantity.toFixed(1)}</span>
                  <span className="font-medium text-slate-700">{percent}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${percent}%` }} />
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-200/80">
                <PlanActions p={p} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
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
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const percent =
                  p.plannedQuantity > 0
                    ? Math.min(100, Math.round((p.actualQuantity / p.plannedQuantity) * 100))
                    : 0;
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${STATUS_ROW[p.status] || "bg-white"}`}>
                    <td className="px-3 py-2.5 font-mono text-xs text-blue-700 font-medium">{p.id}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{p.programName}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[160px] truncate">{p.supplierName || p.supplierId}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.plannedQuantity.toLocaleString("vi-VN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.actualQuantity.toLocaleString("vi-VN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-xs font-medium w-8">{percent}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={p.status} /></td>
                    <td className="px-3 py-2.5"><PlanActions p={p} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
