"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_DETAILS_2026 } from "@/mocks/data";
import type { OrderDetail } from "@/types";

const STATUS_ROW: Record<string, string> = {
  NEW: "bg-amber-50",
  ORDERED: "bg-blue-50",
  RECEIVED: "bg-indigo-50",
  DELIVERING: "bg-violet-50",
  DONE: "bg-emerald-50",
  CANCEL: "bg-red-50",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Mới tạo",
  ORDERED: "Đặt hàng",
  RECEIVED: "Đã nhận",
  DELIVERING: "Đang giao",
  DONE: "Hoàn thành",
  CANCEL: "Hủy",
};

function DetailActions({ d }: { d: OrderDetail }) {
  // V21: Nhận (Đặt hàng), Sửa hàng/Sửa KH (Đặt hàng|Mới tạo), Hủy, Giao (Đã nhận|Đang giao), Xem (Hoàn thành)
  function toast(msg: string) {
    alert(`[Mock] ${msg}\n(CT: ${d.detailId})`);
  }
  const st = d.status;

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {st === "ORDERED" && (
        <button onClick={() => toast("Nhận hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-indigo-600 text-white hover:bg-indigo-500">
          Nhận
        </button>
      )}
      {(st === "ORDERED" || st === "NEW") && (
        <>
          <button onClick={() => toast("Sửa hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-600 text-white hover:bg-slate-500">
            Sửa hàng
          </button>
          <button onClick={() => toast("Sửa KH")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-500 text-white hover:bg-slate-400">
            Sửa KH
          </button>
          <button onClick={() => toast(st === "NEW" ? "Xóa xe" : "Hủy xe")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white hover:bg-red-400">
            {st === "NEW" ? "Xóa" : "Hủy"}
          </button>
        </>
      )}
      {(st === "RECEIVED" || st === "DELIVERING") && (
        <button onClick={() => toast("Giao hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500">
          Giao
        </button>
      )}
      {st === "DONE" && (
        <button onClick={() => toast("Xem giao hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700 hover:bg-slate-300">
          Xem
        </button>
      )}
    </div>
  );
}

export default function DetailsPage() {
  const details = MOCK_DETAILS_2026;

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Chi tiết xe</h2>
          <p className="text-xs text-slate-500">{details.length} dòng</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => alert("[Mock] Tùy chỉnh cột")} className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">
            Tùy chỉnh cột
          </button>
          <button onClick={() => alert("[Mock] Xuất Excel")} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700">
            Xuất Excel
          </button>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {details.map((d) => (
          <div key={d.detailId} className={`rounded-2xl border border-slate-200 p-4 shadow-sm ${STATUS_ROW[d.status] || "bg-white"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">{d.productName || d.productId}</div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">{d.detailId}</div>
              </div>
              <StatusBadge status={STATUS_LABEL[d.status] || d.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <div><div className="text-xs text-slate-500">Đơn</div><div className="font-medium text-blue-700 text-xs">{d.orderId}</div></div>
              <div><div className="text-xs text-slate-500">Xe</div><div className="font-medium">{d.vehicleId}</div></div>
              <div><div className="text-xs text-slate-500">Kế hoạch</div><div className="font-medium">{d.quantity.toFixed(2)}</div></div>
              <div><div className="text-xs text-slate-500">Thực nhận</div><div className="font-medium text-emerald-700">{d.actualReceived?.toFixed(2) ?? "—"}</div></div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/80"><DetailActions d={d} /></div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-semibold">Mã CT</th>
                <th className="px-3 py-2.5 text-left font-semibold">Đơn</th>
                <th className="px-3 py-2.5 text-left font-semibold">Hàng hóa</th>
                <th className="px-3 py-2.5 text-left font-semibold">Xe</th>
                <th className="px-3 py-2.5 text-right font-semibold">KH</th>
                <th className="px-3 py-2.5 text-right font-semibold">TN</th>
                <th className="px-3 py-2.5 text-left font-semibold">TT</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {details.map((d) => (
                <tr key={d.detailId} className={`border-t border-slate-100 ${STATUS_ROW[d.status] || "bg-white"}`}>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{d.detailId}</td>
                  <td className="px-3 py-2.5 text-blue-700 text-xs font-medium">{d.orderId}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{d.productName || d.productId}</td>
                  <td className="px-3 py-2.5">{d.vehicleId}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.quantity.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">{d.actualReceived?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={STATUS_LABEL[d.status] || d.status} /></td>
                  <td className="px-3 py-2.5"><DetailActions d={d} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
