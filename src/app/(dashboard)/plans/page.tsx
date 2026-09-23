"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { statusRowClass } from "@/lib/status-styles";
import type { ProductionPlan } from "@/types";

function PlanActions({ p }: { p: ProductionPlan }) {
  function toast(msg: string) {
    alert(`[Mock] ${msg}\n(${p.id})`);
  }
  const canEdit = p.status !== "Hủy";
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <button
        onClick={() => toast("Xem chi tiết")}
        className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700"
      >
        Xem
      </button>
      {canEdit && (
        <>
          <button
            onClick={() => toast("Sửa kế hoạch — PATCH /planning/:id")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white"
          >
            Sửa
          </button>
          <button
            onClick={() => toast("Hủy kế hoạch — DELETE /planning/:id")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white"
          >
            Hủy
          </button>
        </>
      )}
    </div>
  );
}

function progressPct(p: ProductionPlan) {
  if (!p.plannedQuantity) return 0;
  return Math.min(100, Math.round((p.actualQuantity / p.plannedQuantity) * 100));
}

export default function PlansPage() {
  const [items, setItems] = useState<ProductionPlan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState(2026);
  const pageSize = 50;

  const load = useCallback(
    async (p: number) => {
      const token = localStorage.getItem("token");
      if (!token) return;
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({
          year: String(year),
          page: String(p),
          pageSize: String(pageSize),
        });
        const res = await fetch(`/api/v1/planning?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json.success) {
          setErr(json.error?.message || "Lỗi tải kế hoạch");
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
    },
    [year]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Kế hoạch sản lượng</h2>
          <p className="text-xs text-slate-500">
            {total} kế hoạch · API /api/v1/planning · sheet KHSANLUONG
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white"
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
          </select>
          <button
            onClick={() => load(page)}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tải lại
          </button>
          <button
            onClick={() => alert("[Mock] POST /api/v1/planning — Thêm KH")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
          >
            + Thêm KH
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải kế hoạch...</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {items.map((p) => {
              const pct = progressPct(p);
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl border border-slate-200 p-4 shadow-sm ${
                    statusRowClass(p.status)
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        {p.programName || p.id}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">{p.id}</div>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">NCC</span>
                      <span className="font-medium text-right truncate">
                        {p.supplierName || p.supplierId}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Thời gian</span>
                      <span className="text-xs">
                        {p.fromDate} → {p.toDate}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">KH / TH</span>
                      <span className="font-medium tabular-nums">
                        {p.plannedQuantity.toLocaleString("vi-VN")} /{" "}
                        {p.actualQuantity.toLocaleString("vi-VN")}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 text-right">{pct}%</div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-200/80">
                    <PlanActions p={p} />
                  </div>
                </div>
              );
            })}
            {items.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">
                Không có kế hoạch
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left font-semibold">Mã KH</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Chương trình</th>
                    <th className="px-3 py-2.5 text-left font-semibold">NCC</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Từ → Đến</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Kế hoạch</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Thực tế</th>
                    <th className="px-3 py-2.5 text-left font-semibold">%</th>
                    <th className="px-3 py-2.5 text-left font-semibold">TT</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const pct = progressPct(p);
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-slate-100 ${
                          statusRowClass(p.status)
                        }`}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                          {p.id}
                        </td>
                        <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">
                          {p.programName}
                        </td>
                        <td className="px-3 py-2.5 max-w-[160px] truncate">
                          {p.supplierName || p.supplierId}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                          {p.fromDate} → {p.toDate}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.plannedQuantity.toLocaleString("vi-VN")}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                          {p.actualQuantity.toLocaleString("vi-VN")}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 w-8">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-3 py-2.5">
                          <PlanActions p={p} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {items.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">
                Không có kế hoạch
              </div>
            )}
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
