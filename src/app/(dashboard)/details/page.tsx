"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_DETAILS_2026 } from "@/mocks/data";

export default function DetailsPage() {
  const details = MOCK_DETAILS_2026;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Chi tiết xe</h2>
        <span className="text-xs text-slate-500">{details.length} dòng</span>
      </div>

      <div className="space-y-3">
        {details.map((d) => (
          <div
            key={d.detailId}
            className={`rounded-2xl border p-4 shadow-sm ${
              d.status === "DONE"
                ? "bg-emerald-50/50 border-emerald-100"
                : d.status === "RECEIVED"
                  ? "bg-indigo-50/40 border-indigo-100"
                  : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  {d.productName || d.productId}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 font-mono">
                  {d.detailId}
                </div>
              </div>
              <StatusBadge status={d.status} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div>
                <div className="text-xs text-slate-500">Đơn</div>
                <div className="font-medium text-blue-700">{d.orderId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Xe</div>
                <div className="font-medium">{d.vehicleId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Kế hoạch</div>
                <div className="font-medium">{d.quantity.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Thực nhận</div>
                <div className="font-medium text-emerald-700">
                  {d.actualReceived?.toFixed(2) ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Ngày nhận</div>
                <div className="font-medium">{d.receivedDate || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Phân loại</div>
                <div className="font-medium">{d.phanLoai || "—"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
