"use client";

import { useCallback, useEffect, useState } from "react";
import type { Delivery } from "@/types";

export default function DeliveriesPage() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
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
      const res = await fetch(`/api/v1/deliveries?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải giao hàng");
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
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  function actionLabel(d: Delivery): string {
    if (d.actualQty != null && d.actualQty > 0) return "Xem";
    return "Giao";
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Giao hàng</h2>
          <p className="text-xs text-slate-500">
            {total} lượt · API /api/v1/deliveries
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

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải giao hàng...</div>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {items.map((d) => (
              <div key={d.deliveryId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">
                      {d.customerName || d.customerDetail || d.customerId}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">{d.deliveryId}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-emerald-600">
                      {d.actualQty?.toFixed(2) ?? "—"}
                    </div>
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
                    onClick={() => alert(`[Mock] ${actionLabel(d)} — ${d.deliveryId}`)}
                    className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-600 text-white"
                  >
                    {actionLabel(d)}
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có lượt giao</div>
            )}
          </div>

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
                  {items.map((d) => (
                    <tr key={d.deliveryId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono text-xs">{d.deliveryId}</td>
                      <td className="px-3 py-2.5 text-blue-700 text-xs font-mono">{d.detailId}</td>
                      <td className="px-3 py-2.5 font-medium">{d.customerName || d.customerDetail || d.customerId}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{d.plannedQty.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">{d.actualQty?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{d.deliveryDate || "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => alert(`[Mock] ${actionLabel(d)} — ${d.deliveryId}`)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white"
                        >
                          {actionLabel(d)}
                        </button>
                      </td>
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
