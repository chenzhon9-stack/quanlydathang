"use client";

import React, { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { MOCK_ORDERS_2026 } from "@/mocks/data";
import type { Order } from "@/types";

const STATUS_ROW: Record<string, string> = {
  NEW: "bg-amber-50",
  PROCESSING: "bg-sky-50",
  DONE: "bg-emerald-50",
  CANCEL: "bg-red-50",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Khởi tạo",
  PROCESSING: "Đang xử lý",
  DONE: "Hoàn thành",
  CANCEL: "Hủy đơn",
};

function OrderActions({ o }: { o: Order }) {
  // Theo file nút hành động V21:
  // Khởi tạo: Thêm, Gửi, Xóa
  // Đang xử lý: Hủy (+ Reset ĐH nếu Duyên Hà), PDF nếu có
  // Gửi lại nếu guiLaimail
  const isNew = o.status === "NEW";
  const isProcessing = o.status === "PROCESSING";
  const canCancel = isNew || isProcessing;

  function toast(msg: string) {
    alert(`[Mock] ${msg}\n(Mã đơn: ${o.orderId})`);
  }

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {isNew && (
        <>
          <button
            onClick={() => toast("Thêm xe / mở order flow")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
          >
            Thêm
          </button>
          <button
            onClick={() => toast("Gửi mail NCC")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500"
          >
            Gửi
          </button>
          <button
            onClick={() => toast("Xóa đơn")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white hover:bg-red-400"
          >
            Xóa
          </button>
        </>
      )}
      {isProcessing && (
        <>
          <button
            onClick={() => toast("Hủy đơn")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white hover:bg-red-400"
          >
            Hủy
          </button>
          {o.supplierId === "NCC01" && (
            <button
              onClick={() => toast("Reset ĐH Duyên Hà")}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-amber-500 text-white hover:bg-amber-400"
            >
              Reset ĐH
            </button>
          )}
        </>
      )}
      {o.resendMail && (
        <button
          onClick={() => toast("Gửi lại mail")}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-violet-600 text-white hover:bg-violet-500"
        >
          Gửi lại
        </button>
      )}
      {o.orderFile && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            toast("Mở PDF");
          }}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
        >
          PDF
        </a>
      )}
      {!isNew && !canCancel && !o.orderFile && (
        <span className="text-[11px] text-slate-400">—</span>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const [filter, setFilter] = useState<"ALL" | "NEW" | "PROCESSING" | "DONE" | "CANCEL">("ALL");

  const filtered =
    filter === "ALL"
      ? MOCK_ORDERS_2026
      : MOCK_ORDERS_2026.filter((o) => o.status === filter);

  const byDate = filtered.reduce<Record<string, typeof filtered>>((acc, o) => {
    if (!acc[o.orderDate]) acc[o.orderDate] = [];
    acc[o.orderDate].push(o);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4 max-w-full">
      {/* Header + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Đơn hàng</h2>
          <p className="text-xs text-slate-500">{filtered.length} đơn</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => alert("[Mock] Xuất CSV")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700"
          >
            Xuất CSV
          </button>
          <button
            onClick={() => alert("[Mock] Thêm đơn mới")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500"
          >
            + Thêm đơn
          </button>
        </div>
      </div>

      {/* Status chips */}
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

      {/* ===== MOBILE: CARD ===== */}
      <div className="md:hidden space-y-3">
        {filtered.map((o) => (
          <div
            key={o.orderId}
            className={`rounded-2xl border p-4 shadow-sm ${
              STATUS_ROW[o.status] || "bg-white"
            } border-slate-200`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-blue-700">{o.orderId}</div>
                <div className="text-xs text-slate-500 mt-0.5">{o.orderDate}</div>
              </div>
              <StatusBadge status={STATUS_LABEL[o.status] || o.status} />
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 shrink-0">NCC</span>
                <span className="font-medium text-right text-slate-800 truncate">
                  {o.supplierName || o.supplierId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Số chi tiết</span>
                <span className="font-medium">{o.detailCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Người tạo</span>
                <span className="text-xs text-slate-600 truncate max-w-[55%]">
                  {o.createdBy}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/80">
              <OrderActions o={o} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">Không có đơn hàng</div>
        )}
      </div>

      {/* ===== DESKTOP: TABLE ===== */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-semibold">Mã đơn</th>
                <th className="px-3 py-2.5 text-left font-semibold">Ngày đặt</th>
                <th className="px-3 py-2.5 text-left font-semibold">Nhà cung cấp</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tổng KH</th>
                <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 text-left font-semibold">Người tạo</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <React.Fragment key={`g-${date}`}>
                  <tr className="bg-slate-700 text-white">
                    <td colSpan={7} className="px-3 py-2 text-xs font-medium">
                      📅 Ngày đặt lệnh: {date.split("-").reverse().join("/")}
                    </td>
                  </tr>
                  {byDate[date].map((o) => (
                    <tr
                      key={o.orderId}
                      className={`border-t border-slate-100 ${STATUS_ROW[o.status] || "bg-white"} hover:brightness-95`}
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-semibold text-blue-700">{o.orderId}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs whitespace-nowrap">
                        {o.orderDate}
                      </td>
                      <td className="px-3 py-2.5 text-slate-800 max-w-[220px] truncate">
                        {o.supplierName || o.supplierId}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                        {(o.detailCount * 30).toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={STATUS_LABEL[o.status] || o.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 truncate max-w-[140px]">
                        {o.createdBy}
                      </td>
                      <td className="px-3 py-2.5">
                        <OrderActions o={o} />
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">Không có đơn hàng</div>
        )}
      </div>
    </div>
  );
}
