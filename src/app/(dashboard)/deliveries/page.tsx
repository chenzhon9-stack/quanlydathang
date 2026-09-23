"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListToolbar,
  toggleStatus,
  matchStatuses,
  matchSearch,
} from "@/components/ListToolbar";
import type { Delivery } from "@/types";
import { ActionPrompt, apiPatch } from "@/components/ActionPrompt";
import { downloadExcelHtml } from "@/lib/export-excel";

function fmtDateVN(ymd: string) {
  if (!ymd || ymd === "—" || ymd === "all") return ymd === "all" ? "Tất cả" : "—";
  const p = ymd.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return ymd;
}

function actionLabel(d: Delivery) {
  if (d.deleted) return "Khôi phục";
  if ((d.actualQty || 0) > 0) return "Sửa giao";
  return "Cập nhật";
}

export default function DeliveriesPage() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<string[]>(["ALL"]);
  const [search, setSearch] = useState("");
  const [groupByDate, setGroupByDate] = useState(true);
  const [editTarget, setEditTarget] = useState<Delivery | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pageSize = 100;

  const load = useCallback(async (p: number) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        year: String(new Date().getFullYear()),
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
        setTotal(0);
        return;
      }
      const data = json.data;
      setItems(data.items || data || []);
      setTotal(data.total ?? (data.items?.length || 0));
      setHasMore(!!data.hasMore);
      setPage(p);
    } catch {
      setErr("Không kết nối được API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const filtered = useMemo(() => {
    return items.filter((d) => {
      const st = d.deleted ? "DELETED" : (d.actualQty || 0) > 0 ? "DONE" : "PENDING";
      if (!(statuses.length === 0 || statuses.includes("ALL"))) {
        if (!statuses.includes(st)) return false;
      }
      const hay = [
        d.deliveryId,
        d.detailId,
        d.customerId,
        d.customerName || "",
        d.customerDetail || "",
        d.deliveryDate || "",
        d.orderDate || "",
        d.vehiclePlate || "",
        d.productName || "",
        String(d.plannedQty),
        String(d.actualQty ?? ""),
      ].join(" ");
      return matchSearch(hay, search);
    });
  }, [items, statuses, search]);

  /** Gom theo ngày đặt lệnh (V21) — fallback ngày giao */
  const displayGroups = useMemo(() => {
    if (!groupByDate) return [{ key: "all", items: filtered }];
    const byDate: Record<string, Delivery[]> = {};
    for (const d of filtered) {
      const key = d.orderDate || d.deliveryDate || "—";
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(d);
    }
    return Object.keys(byDate)
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, items: byDate[k] }));
  }, [filtered, groupByDate]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Giao hàng</h2>
          <p className="text-xs text-slate-500">
            {total} lượt · gom theo ngày đặt lệnh
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load(page)}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tải lại
          </button>
          <button
            onClick={() => {
              downloadExcelHtml(
                `GiaoHang_${new Date().toISOString().slice(0, 10)}.xls`,
                "GiaoHang",
                ["Mã GH", "CT", "Ngày đặt", "Xe", "KH", "SL KH", "Thực giao", "Ngày giao"],
                filtered.map((d) => [
                  d.deliveryId,
                  d.detailId,
                  d.orderDate || "",
                  d.vehiclePlate || "",
                  d.customerName || d.customerId,
                  d.plannedQty,
                  d.actualQty ?? "",
                  d.deliveryDate || "",
                ])
              );
            }}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-emerald-700 text-white"
          >
            Xuất Excel
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã GH, CT, khách, biển số…"
        statuses={[
          { key: "ALL", label: "Tất cả" },
          { key: "PENDING", label: "Chưa giao" },
          { key: "DONE", label: "Đã giao" },
          { key: "DELETED", label: "Đã xóa" },
        ]}
        selectedStatuses={statuses}
        onToggleStatus={(k) => setStatuses((s) => toggleStatus(s, k))}
        groupByDate={groupByDate}
        onGroupByDate={setGroupByDate}
        countLabel={`${filtered.length}/${items.length}`}
      />

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải giao hàng...</div>
      ) : (
        <>
          {/* Mobile cards — header ngày đặt lệnh sticky */}
          <div className="md:hidden space-y-4">
            {displayGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                {groupByDate && (
                  <div className="sticky top-0 z-10 rounded-xl bg-slate-800 text-white px-3 py-2.5 text-sm font-semibold shadow-md">
                    📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                    <span className="ml-2 text-xs font-normal text-slate-300">
                      ({g.items.length})
                    </span>
                  </div>
                )}
                {g.items.map((d) => (
                  <div
                    key={d.deliveryId}
                    className="rounded-2xl border border-slate-200 bg-amber-50/60 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs text-slate-500">Ngày đặt</div>
                      <div className="text-sm font-medium text-orange-700">
                        {fmtDateVN(d.orderDate || d.deliveryDate || "")}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">Biển số</span>
                      <span className="bg-amber-300 text-amber-950 px-2.5 py-0.5 rounded font-bold text-sm">
                        {d.vehiclePlate || "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between gap-2 text-sm">
                      <span className="text-slate-500">ID Giao hàng</span>
                      <span className="font-mono text-xs text-orange-800">{d.deliveryId}</span>
                    </div>
                    <div className="mt-2 flex justify-between gap-2 text-sm">
                      <span className="text-slate-500">Khách hàng</span>
                      <span className="font-medium text-right truncate max-w-[60%]">
                        {d.customerName || d.customerDetail || d.customerId}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between text-sm">
                      <span className="text-slate-500">KH / Thực giao</span>
                      <span className="tabular-nums font-medium">
                        {d.plannedQty.toFixed(2)} /{" "}
                        <span className="text-emerald-700">
                          {d.actualQty?.toFixed(2) ?? "—"}
                        </span>
                      </span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200/80 flex justify-end">
                      <button
                        onClick={() => setEditTarget(d)}
                        className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-600 text-white"
                      >
                        {actionLabel(d)}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có lượt giao</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left font-semibold">Mã GH</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Chi tiết</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Xe</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Khách hàng</th>
                    <th className="px-3 py-2.5 text-right font-semibold">KH</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Thực giao</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Ngày giao</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {displayGroups.map((g) => (
                    <React.Fragment key={g.key}>
                      {groupByDate && (
                        <tr className="bg-slate-800 text-white">
                          <td colSpan={8} className="px-3 py-2 text-xs font-medium">
                            📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                            <span className="ml-2 opacity-70">({g.items.length} lượt)</span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((d) => (
                        <tr key={d.deliveryId} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-mono text-xs">{d.deliveryId}</td>
                          <td className="px-3 py-2.5 text-blue-700 text-xs font-mono">{d.detailId}</td>
                          <td className="px-3 py-2.5">
                            <span className="bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded text-xs font-semibold">
                              {d.vehiclePlate || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-medium">
                            {d.customerName || d.customerDetail || d.customerId}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {d.plannedQty.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                            {d.actualQty?.toFixed(2) ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {d.deliveryDate ? fmtDateVN(d.deliveryDate) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => setEditTarget(d)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white"
                            >
                              {actionLabel(d)}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có lượt giao</div>
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
      {editTarget && (
        <ActionPrompt
          open
          title={`${actionLabel(editTarget)} — ${editTarget.deliveryId}`}
          fields={[
            {
              key: "actualQty",
              label: "Thực giao (tấn)",
              type: "number",
              defaultValue: editTarget.actualQty ?? editTarget.plannedQty,
            },
            {
              key: "deliveryDate",
              label: "Ngày giao",
              type: "date",
              defaultValue:
                editTarget.deliveryDate ||
                new Date().toISOString().slice(0, 10),
            },
            {
              key: "note",
              label: "Ghi chú",
              type: "text",
              defaultValue: editTarget.note || "",
            },
          ]}
          confirmLabel="Lưu"
          onCancel={() => setEditTarget(null)}
          onConfirm={async (vals) => {
            const json = await apiPatch(
              `/api/v1/deliveries/${encodeURIComponent(editTarget.deliveryId)}`,
              {
                actualQty: Number(vals.actualQty),
                deliveryDate: vals.deliveryDate,
                note: vals.note,
                year: new Date().getFullYear(),
              }
            );
            if (!json.success)
              throw new Error(json.error?.message || "Lỗi cập nhật giao");
            setEditTarget(null);
            load(page);
          }}
        />
      )}
    </div>
  );
}
