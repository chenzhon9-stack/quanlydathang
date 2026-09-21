"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
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
  function toast(msg: string) {
    alert(`[Mock] ${msg}\n(CT: ${d.detailId})`);
  }
  const st = d.status;
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {st === "ORDERED" && (
        <button onClick={() => toast("Nhận hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-indigo-600 text-white">
          Nhận
        </button>
      )}
      {(st === "ORDERED" || st === "NEW") && (
        <>
          <button onClick={() => toast("Sửa hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-600 text-white">
            Sửa hàng
          </button>
          <button onClick={() => toast("Sửa KH")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-500 text-white">
            Sửa KH
          </button>
          <button onClick={() => toast(st === "NEW" ? "Xóa xe" : "Hủy xe")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white">
            {st === "NEW" ? "Xóa" : "Hủy"}
          </button>
        </>
      )}
      {(st === "RECEIVED" || st === "DELIVERING") && (
        <button onClick={() => toast("Giao hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white">
          Giao
        </button>
      )}
      {st === "DONE" && (
        <button onClick={() => toast("Xem giao hàng")} className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700">
          Xem
        </button>
      )}
    </div>
  );
}

export default function DetailsPage() {
  const [items, setItems] = useState<OrderDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");
  const pageSize = 50;

  const load = useCallback(async (p: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        year: "2026",
        page: String(p),
        pageSize: String(pageSize),
      });
      if (status !== "ALL") qs.set("status", status);
      const res = await fetch(`/api/v1/order-details?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải chi tiết");
        setItems([]);
        return;
      }
      setItems(json.data.items || []);
      setTotal(json.data.total || 0);
      setHasMore(Boolean(json.data.hasMore));
      setPage(json.data.page || p);
    } catch {
      setErr("Không kết nối được API");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load(1);
  }, [load]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Chi tiết xe</h2>
          <p className="text-xs text-slate-500">
            {total} dòng · API /api/v1/order-details
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200">
            Tải lại
          </button>
          <button onClick={() => alert("[Mock] Xuất Excel")} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white">
            Xuất Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["ALL", "Tất cả"],
          ["NEW", "Mới tạo"],
          ["ORDERED", "Đặt hàng"],
          ["RECEIVED", "Đã nhận"],
          ["DELIVERING", "Đang giao"],
          ["DONE", "Hoàn thành"],
        ].map(([k, lab]) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              status === k
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200"
            }`}
          >
            {lab}
          </button>
        ))}
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải chi tiết...</div>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {items.map((d) => (
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
                  <div><div className="text-xs text-slate-500">Xe</div><div className="font-medium">{d.vehiclePlate || d.vehicleId}</div></div>
                  <div><div className="text-xs text-slate-500">Kế hoạch</div><div className="font-medium">{d.quantity.toFixed(2)}</div></div>
                  <div><div className="text-xs text-slate-500">Thực nhận</div><div className="font-medium text-emerald-700">{d.actualReceived?.toFixed(2) ?? "—"}</div></div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200/80"><DetailActions d={d} /></div>
              </div>
            ))}
            {items.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có chi tiết</div>
            )}
          </div>

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
                  {items.map((d) => (
                    <tr key={d.detailId} className={`border-t border-slate-100 ${STATUS_ROW[d.status] || "bg-white"}`}>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{d.detailId}</td>
                      <td className="px-3 py-2.5 text-blue-700 text-xs font-medium">{d.orderId}</td>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{d.productName || d.productId}</td>
                      <td className="px-3 py-2.5">{d.vehiclePlate || d.vehicleId}</td>
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

          {total > pageSize && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => load(page - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
              >
                ‹ Trước
              </button>
              <span className="text-slate-500 text-xs">
                Trang {page} / {Math.max(1, Math.ceil(total / pageSize))}
              </span>
              <button
                disabled={!hasMore}
                onClick={() => load(page + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
              >
                Sau ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
