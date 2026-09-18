"use client";

import React, { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_ORDERS_2026 } from "@/mocks/data";

const STATUS_ROW: Record<string, string> = {
  NEW: "bg-amber-50 hover:bg-amber-100/80",
  "Khởi tạo": "bg-amber-50 hover:bg-amber-100/80",
  PROCESSING: "bg-sky-50 hover:bg-sky-100/80",
  "Đang xử lý": "bg-sky-50 hover:bg-sky-100/80",
  DONE: "bg-emerald-50 hover:bg-emerald-100/70",
  "Hoàn thành": "bg-emerald-50 hover:bg-emerald-100/70",
  CANCEL: "bg-red-50 hover:bg-red-100/70",
  "Hủy đơn": "bg-red-50 hover:bg-red-100/70",
};

export default function OrdersPage() {
  const [filter, setFilter] = useState<"ALL" | "NEW" | "PROCESSING" | "DONE" | "CANCEL">("ALL");

  const filtered =
    filter === "ALL"
      ? MOCK_ORDERS_2026
      : MOCK_ORDERS_2026.filter((o) => o.status === filter);

  const byDate = filtered.reduce<Record<string, typeof filtered>>((acc, o) => {
    const d = o.orderDate;
    if (!acc[d]) acc[d] = [];
    acc[d].push(o);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Đơn hàng</h2>
        <span className="text-xs text-slate-500">{filtered.length} đơn</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "ALL", label: "Tất cả" },
          { key: "NEW", label: "Khởi tạo" },
          { key: "PROCESSING", label: "Đang xử lý" },
          { key: "DONE", label: "Hoàn thành" },
          { key: "CANCEL", label: "Hủy đơn" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === f.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-semibold">Mã đơn</th>
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">Ngày đặt</th>
                <th className="px-3 py-2.5 text-left font-semibold">Nhà cung cấp</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tổng KH</th>
                <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 text-left font-semibold">Người tạo</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <React.Fragment key={`g-${date}`}>
                  <tr className="bg-slate-700 text-white">
                    <td colSpan={6} className="px-3 py-2 text-xs font-medium">
                      📅 Ngày đặt lệnh: {date.split("-").reverse().join("/")}
                    </td>
                  </tr>
                  {byDate[date].map((o) => (
                    <tr
                      key={o.orderId}
                      className={`border-t border-slate-100 transition ${
                        STATUS_ROW[o.status] || "bg-white hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-blue-700">{o.orderId}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap text-xs">
                        {o.orderDate}
                      </td>
                      <td className="px-3 py-2.5 text-slate-800 max-w-[180px] truncate">
                        {o.supplierName || o.supplierId}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">
                        {(o.detailCount * 30).toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 truncate max-w-[120px]">
                        {o.createdBy}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            Không có đơn hàng
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400 text-center md:hidden">
        Vuốt ngang để xem đủ cột
      </p>
    </div>
  );
}
