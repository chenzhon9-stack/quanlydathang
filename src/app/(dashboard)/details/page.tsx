"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListToolbar,
  toggleStatus,
  matchStatuses,
  matchSearch,
} from "@/components/ListToolbar";
import { StatusBadge } from "@/components/StatusBadge";
import type { OrderDetail } from "@/types";
import { ActionPrompt, apiPost } from "@/components/ActionPrompt";
import { downloadExcelHtml } from "@/lib/export-excel";

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

function fmtDateVN(ymd: string) {
  if (!ymd || ymd === "—" || ymd === "all") return ymd === "all" ? "Tất cả" : "—";
  const p = ymd.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return ymd;
}

type DetailActionHandlers = {
  onReceive: (d: OrderDetail) => void;
  onCancel: (d: OrderDetail, mode: "cancel" | "delete") => void;
  onDelivery: (d: OrderDetail) => void;
};

function DetailActions({
  d,
  handlers,
}: {
  d: OrderDetail;
  handlers: DetailActionHandlers;
}) {
  const st = d.status;
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {st === "ORDERED" && (
        <button
          type="button"
          onClick={() => handlers.onReceive(d)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-indigo-600 text-white"
        >
          Nhận
        </button>
      )}
      {(st === "ORDERED" || st === "NEW") && (
        <>
          <button
            type="button"
            onClick={() => alert("Sửa hàng — modal sẽ bổ sung (V21 openEditDetail)")}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-600 text-white"
          >
            Sửa hàng
          </button>
          <button
            type="button"
            onClick={() => handlers.onDelivery(d)}
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-500 text-white"
          >
            Sửa KH
          </button>
          <button
            type="button"
            onClick={() =>
              handlers.onCancel(d, st === "NEW" ? "delete" : "cancel")
            }
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-500 text-white"
          >
            {st === "NEW" ? "Xóa" : "Hủy"}
          </button>
        </>
      )}
      {(st === "RECEIVED" || st === "DELIVERING") && (
        <button
          type="button"
          onClick={() => handlers.onDelivery(d)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white"
        >
          Giao
        </button>
      )}
      {st === "DONE" && (
        <button
          type="button"
          onClick={() => handlers.onDelivery(d)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-200 text-slate-700"
        >
          Xem
        </button>
      )}
      {receiveTarget && (
        <ActionPrompt
          open
          title={`Nhận hàng — ${receiveTarget.detailId}`}
          fields={[
            {
              key: "actualReceived",
              label: "Thực nhận (tấn)",
              type: "number",
              defaultValue: receiveTarget.quantity,
            },
            {
              key: "receivedDate",
              label: "Ngày nhận",
              type: "date",
              defaultValue: new Date().toISOString().slice(0, 10),
            },
          ]}
          confirmLabel="Xác nhận nhận"
          onCancel={() => setReceiveTarget(null)}
          onConfirm={async (vals) => {
            const json = await apiPost(
              `/api/v1/order-details/${encodeURIComponent(receiveTarget.detailId)}/receive`,
              {
                actualReceived: Number(vals.actualReceived),
                receivedDate: vals.receivedDate,
                year: new Date().getFullYear(),
              }
            );
            if (!json.success) throw new Error(json.error?.message || "Lỗi nhận hàng");
            setReceiveTarget(null);
            load(page);
          }}
        />
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
  const [statuses, setStatuses] = useState<string[]>(["ALL"]);
  const [search, setSearch] = useState("");
  const [groupByDate, setGroupByDate] = useState(true);
  const [receiveTarget, setReceiveTarget] = useState<OrderDetail | null>(null);
  const pageSize = 100;

  const handlers: DetailActionHandlers = {
    onReceive: (d) => setReceiveTarget(d),
    onCancel: async (d, mode) => {
      const label = mode === "delete" ? "Xóa" : "Hủy";
      if (!confirm(`${label} chi tiết ${d.detailId}?`)) return;
      const json = await apiPost(
        `/api/v1/order-details/${encodeURIComponent(d.detailId)}/cancel`,
        { mode, year: new Date().getFullYear() }
      );
      if (!json.success) {
        alert(json.error?.message || "Lỗi " + label);
        return;
      }
      load(page);
    },
    onDelivery: (d) => {
      // Chuyển sang tab giao — filter theo detail
      window.location.href = `/deliveries?detailId=${encodeURIComponent(d.detailId)}`;
    },
  };

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
      const res = await fetch(`/api/v1/order-details?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        // fallback path
        const res2 = await fetch(`/api/v1/order-details?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j2 = await res2.json();
        if (!j2.success) {
          setErr(json.error?.message || j2.error?.message || "Lỗi tải chi tiết");
          setItems([]);
          return;
        }
        const data = j2.data;
        setItems(data.items || data || []);
        setTotal(data.total ?? (data.items?.length || 0));
        setHasMore(!!data.hasMore);
        setPage(p);
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
      if (!matchStatuses(d.status, statuses)) return false;
      const hay = [
        d.detailId,
        d.orderId,
        d.supplierId,
        d.supplierName || "",
        d.vehicleId,
        d.vehiclePlate || "",
        d.productId,
        d.productName || "",
        d.status,
        d.orderDate,
        d.receivedDate || "",
      ].join(" ");
      return matchSearch(hay, search);
    });
  }, [items, statuses, search]);

  const displayGroups = useMemo(() => {
    if (!groupByDate) return [{ key: "all", items: filtered }];
    const byDate: Record<string, OrderDetail[]> = {};
    for (const d of filtered) {
      const key = d.orderDate || "—";
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
          <h2 className="text-xl font-bold text-slate-800">Chi tiết xe</h2>
          <p className="text-xs text-slate-500">{total} chi tiết · gom theo ngày đặt lệnh</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200">
            Tải lại
          </button>
          <button onClick={() => {
              downloadExcelHtml(
                `ChiTietXe_${new Date().toISOString().slice(0, 10)}.xls`,
                "ChiTiet",
                ["Mã CT", "Đơn", "Ngày đặt", "Hàng", "Xe", "SL", "TN", "TT", "NCC"],
                filtered.map((d) => [
                  d.detailId,
                  d.orderId,
                  d.orderDate,
                  d.productName || d.productId,
                  d.vehiclePlate || d.vehicleId,
                  d.quantity,
                  d.actualReceived ?? "",
                  d.status,
                  d.supplierName || d.supplierId,
                ])
              );
            }} className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white">
            Xuất Excel
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã CT, đơn, xe, hàng, NCC…"
        statuses={[
          { key: "ALL", label: "Tất cả" },
          { key: "NEW", label: "Mới tạo" },
          { key: "ORDERED", label: "Đặt hàng" },
          { key: "RECEIVED", label: "Đã nhận" },
          { key: "DELIVERING", label: "Đang giao" },
          { key: "DONE", label: "Hoàn thành" },
          { key: "CANCEL", label: "Hủy" },
        ]}
        selectedStatuses={statuses}
        onToggleStatus={(k) => setStatuses((s) => toggleStatus(s, k))}
        groupByDate={groupByDate}
        onGroupByDate={setGroupByDate}
        countLabel={`${filtered.length}/${items.length}`}
      />

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải chi tiết...</div>
      ) : (
        <>
          {/* Mobile cards — gom theo ngày đặt */}
          <div className="md:hidden space-y-4">
            {displayGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                {groupByDate && (
                  <div className="sticky top-0 z-10 rounded-xl bg-slate-800 text-white px-3 py-2 text-sm font-semibold shadow">
                    📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                    <span className="ml-2 text-xs font-normal text-slate-300">
                      ({g.items.length})
                    </span>
                  </div>
                )}
                {g.items.map((d) => (
                  <div
                    key={d.detailId}
                    className={`rounded-2xl border p-4 shadow-sm ${STATUS_ROW[d.status] || "bg-white"} border-slate-200`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-blue-700">{d.orderId}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{d.detailId}</div>
                      </div>
                      <StatusBadge status={STATUS_LABEL[d.status] || d.status} />
                    </div>
                    <div className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Xe</span>
                        <span className="font-semibold bg-amber-300/80 text-amber-950 px-2 py-0.5 rounded text-xs">
                          {d.vehiclePlate || d.vehicleId || "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500">Hàng</span>
                        <span className="font-medium text-right truncate max-w-[60%]">
                          {d.productName || d.productId}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">KH / TN</span>
                        <span className="tabular-nums">
                          {d.quantity.toFixed(2)} / {d.actualReceived?.toFixed(2) ?? "—"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200/80">
                      <DetailActions d={d} handlers={handlers} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có chi tiết</div>
            )}
          </div>

          {/* Desktop table — gom theo ngày đặt */}
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
                  {displayGroups.map((g) => (
                    <React.Fragment key={g.key}>
                      {groupByDate && (
                        <tr className="bg-slate-800 text-white">
                          <td colSpan={8} className="px-3 py-2 text-xs font-medium">
                            📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                            <span className="ml-2 opacity-70">({g.items.length} xe)</span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((d) => (
                        <tr
                          key={d.detailId}
                          className={`border-t border-slate-100 ${STATUS_ROW[d.status] || "bg-white"}`}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{d.detailId}</td>
                          <td className="px-3 py-2.5 text-blue-700 text-xs font-medium">{d.orderId}</td>
                          <td className="px-3 py-2.5 font-medium text-slate-800">
                            {d.productName || d.productId}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded text-xs font-semibold">
                              {d.vehiclePlate || d.vehicleId || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{d.quantity.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-medium">
                            {d.actualReceived?.toFixed(2) ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={STATUS_LABEL[d.status] || d.status} />
                          </td>
                          <td className="px-3 py-2.5">
                            <DetailActions d={d} handlers={handlers} />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">Không có chi tiết</div>
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
      {receiveTarget && (
        <ActionPrompt
          open
          title={`Nhận hàng — ${receiveTarget.detailId}`}
          fields={[
            {
              key: "actualReceived",
              label: "Thực nhận (tấn)",
              type: "number",
              defaultValue: receiveTarget.quantity,
            },
            {
              key: "receivedDate",
              label: "Ngày nhận",
              type: "date",
              defaultValue: new Date().toISOString().slice(0, 10),
            },
          ]}
          confirmLabel="Xác nhận nhận"
          onCancel={() => setReceiveTarget(null)}
          onConfirm={async (vals) => {
            const json = await apiPost(
              `/api/v1/order-details/${encodeURIComponent(receiveTarget.detailId)}/receive`,
              {
                actualReceived: Number(vals.actualReceived),
                receivedDate: vals.receivedDate,
                year: new Date().getFullYear(),
              }
            );
            if (!json.success) throw new Error(json.error?.message || "Lỗi nhận hàng");
            setReceiveTarget(null);
            load(page);
          }}
        />
      )}
    </div>
  );
}
