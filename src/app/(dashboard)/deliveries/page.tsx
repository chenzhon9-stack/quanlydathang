"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListToolbar,
  toggleStatus,
  matchStatuses,
  matchSearch,
} from "@/components/ListToolbar";
import type { Delivery } from "@/types";
import { PlateBadge, StatusBadge } from "@/components/StatusBadge";
import { statusRowClass, statusBadgeClass, PLATE_CLASS, DATE_GROUP_HEADER, matchStatusFilter } from "@/lib/status-styles";
import { ColumnCustomizer } from "@/components/ColumnCustomizer";
import {
  HeaderFilterTh,
  cycleSort,
  compareValues,
  type SortDir,
} from "@/components/HeaderFilterTh";
import {
  type ColumnState,
  loadColumnState,
  resolveColumns,
} from "@/lib/column-prefs";
import { DELIVERY_COLUMN_DEFS } from "@/lib/column-definitions";
import { downloadExcelHtml } from "@/lib/export-excel";
import {
  DeliveryEditorModal,
  summaryFromDelivery,
  type DeliveryModalMode,
} from "@/components/DeliveryEditorModal";

function fmtDateVN(ymd: string) {
  if (!ymd || ymd === "—" || ymd === "all") return ymd === "all" ? "Tất cả" : "—";
  const p = ymd.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return ymd;
}


const DELIVERY_COLUMNS = DELIVERY_COLUMN_DEFS;

/** Chuẩn hóa trạng thái CT (EN/VN) */
function normCtStatus(raw: string): string {
  const s = String(raw || "").trim();
  const u = s.toUpperCase();
  const fold = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (u === "CANCEL" || fold.includes("huy xe") || fold === "huy") return "CANCEL";
  if (u === "DELETE" || fold.includes("xoa xe") || fold === "xoa") return "DELETE";
  if (u === "DONE" || fold.includes("hoan thanh")) return "DONE";
  if (u === "RECEIVED" || fold.includes("da nhan")) return "RECEIVED";
  if (u === "DELIVERING" || fold.includes("dang giao")) return "DELIVERING";
  if (u === "ORDERED" || fold.includes("dat hang")) return "ORDERED";
  if (u === "NEW" || fold.includes("moi tao") || fold.includes("khoi tao")) return "NEW";
  return u || fold;
}

/** Hiển thị trạng thái tiếng Việt — parity V21 STATUS_CT */
function statusLabelVN(raw: string): string {
  const n = normCtStatus(raw);
  const map: Record<string, string> = {
    NEW: "Mới tạo",
    ORDERED: "Đặt hàng",
    RECEIVED: "Đã nhận",
    DELIVERING: "Đang giao",
    DONE: "Hoàn thành",
    CANCEL: "Hủy xe",
    DELETE: "Xóa xe",
  };
  return map[n] || (raw ? String(raw) : "—");
}

/** V21 deliveryActionText — CANCEL/DELETE/DONE → Xem (không Giao) */
function actionLabel(d: Delivery) {
  if (d.deleted) return "Xem";
  const st = normCtStatus(String(d.detailStatus || ""));
  if (st === "CANCEL" || st === "DELETE" || st === "DONE") return "Xem";
  if (st === "RECEIVED" || st === "DELIVERING") return "Giao";
  if (st === "NEW" || st === "ORDERED") return "Sửa";
  // fallback: đã giao đủ KH → Xem; còn lại Giao chỉ khi đã nhận
  const planned = Number(d.plannedQty) || 0;
  const actual = Number(d.actualQty) || 0;
  if (planned > 0 && actual + 0.0001 >= planned) return "Xem";
  if ((Number(d.actualReceived) || 0) > 0) return "Giao";
  return "Xem";
}

function isViewOnly(d: Delivery) {
  return actionLabel(d) === "Xem";
}

function modeFromDelivery(d: Delivery): DeliveryModalMode {
  const label = actionLabel(d);
  if (label === "Xem") return "view";
  if (label === "Sửa") return "plan";
  return "real";
}



function isColVisible(visibleCols: { key: string }[], key: string): boolean {
  return visibleCols.some((c) => c.key === key);
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
  const [modalTarget, setModalTarget] = useState<{
    delivery: Delivery;
    mode: DeliveryModalMode;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [colOpen, setColOpen] = useState(false);
  const [colState, setColState] = useState<ColumnState>(() =>
    loadColumnState("delivery", DELIVERY_COLUMNS)
  );
  const [valFilters, setValFilters] = useState<Record<string, string[]>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

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
      // Chip trạng thái — so khớp EN/VN (ORDERED ↔ Đặt hàng)
      if (!matchStatusFilter(d.detailStatus, statuses)) return false;
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
        String(d.detailStatus || ""),
        String(d.plannedQty),
        String(d.actualQty ?? ""),
      ].join(" ");
      return matchSearch(hay, search);
    });
  }, [items, statuses, search]);

  const visibleCols = useMemo(
    () => resolveColumns(DELIVERY_COLUMNS, colState),
    [colState]
  );

  const filteredCols = useMemo(() => {
    return filtered.filter((d) => {
      const planned = Number(d.plannedQty) || 0;
      const actual = Number(d.actualQty) || 0;
      const checks: [string, string][] = [
        ["status", String(d.detailStatus || "")],
        ["customer", d.customerName || d.customerDetail || d.customerId || ""],
        ["customerId", d.customerId || ""],
        ["customerDetail", d.customerDetail || ""],
        ["plate", d.vehiclePlate || ""],
        ["id", d.deliveryId || ""],
        ["detailId", d.detailId || ""],
        ["date", String(d.deliveryDate || "").slice(0, 10)],
        ["orderDate", String(d.orderDate || "").slice(0, 10)],
        ["recvDate", String((d as { receivedDate?: string }).receivedDate || "").slice(0, 10)],
        ["product", d.productName || d.productId || ""],
        ["productId", d.productId || ""],
        ["vehicleId", d.vehicleId || ""],
      ];
      for (const [key, val] of checks) {
        const sel = valFilters[key];
        if (sel?.length && !sel.includes(val)) return false;
      }
      return true;
    });
  }, [filtered, valFilters]);

  const colUnique = useMemo(() => {
    const map: Record<string, string[]> = {};
    const buckets: Record<string, Set<string>> = {
      id: new Set(),
      detailId: new Set(),
      plate: new Set(),
      status: new Set(),
      customer: new Set(),
      customerId: new Set(),
      date: new Set(),
      orderDate: new Set(),
      product: new Set(),
      productId: new Set(),
      vehicleId: new Set(),
    };
    for (const d of filtered) {
      buckets.id?.add(d.deliveryId || "");
      buckets.detailId?.add(d.detailId || "");
      if (d.vehiclePlate) buckets.plate?.add(d.vehiclePlate);
      if (d.detailStatus) buckets.status?.add(String(d.detailStatus));
      const c = d.customerName || d.customerDetail || d.customerId;
      if (c) buckets.customer?.add(c);
      if (d.customerId) buckets.customerId?.add(d.customerId);
      if (d.deliveryDate) buckets.date?.add(String(d.deliveryDate).slice(0, 10));
      if (d.orderDate) buckets.orderDate?.add(String(d.orderDate).slice(0, 10));
      if (d.productName || d.productId)
        buckets.product?.add(d.productName || d.productId || "");
      if (d.productId) buckets.productId?.add(d.productId);
      if (d.vehicleId) buckets.vehicleId?.add(d.vehicleId);
    }
    for (const [k, set] of Object.entries(buckets)) {
      map[k] = [...set].filter(Boolean).sort();
    }
    return map;
  }, [filtered]);


  function delSortVal(d: Delivery, key: string): string | number {
    const planned = Number(d.plannedQty) || 0;
    const actual = Number(d.actualQty) || 0;
    switch (key) {
      case "id":
        return d.deliveryId || "";
      case "detailId":
        return d.detailId || "";
      case "plate":
        return d.vehiclePlate || "";
      case "status":
        return String(d.detailStatus || "");
      case "customer":
        return d.customerName || d.customerDetail || d.customerId || "";
      case "customerId":
        return d.customerId || "";
      case "product":
        return d.productName || d.productId || "";
      case "productId":
        return d.productId || "";
      case "orderDate":
        return String(d.orderDate || "");
      case "planned":
        return planned;
      case "actual":
        return actual;
      case "diff":
        return actual - planned;
      case "actualRecv":
        return Number(d.actualReceived) || 0;
      case "date":
        return String(d.deliveryDate || "");
      case "vehicleId":
        return d.vehicleId || "";
      default:
        return "";
    }
  }

  const sortedFiltered = useMemo(() => {
    const rows = [...filteredCols];
    if (sortKey && sortDir) {
      rows.sort((a, b) =>
        compareValues(delSortVal(a, sortKey), delSortVal(b, sortKey), sortDir)
      );
      return rows;
    }
    // Mặc định V21: Ngày đặt DESC → Mã xe ASC → Mã chi tiết ASC
    rows.sort((a, b) => {
      const da = String(a.orderDate || "").slice(0, 10);
      const db = String(b.orderDate || "").slice(0, 10);
      if (da !== db) return db.localeCompare(da); // DESC
      const va = String(a.vehicleId || "").toLowerCase();
      const vb = String(b.vehicleId || "").toLowerCase();
      if (va !== vb) return va.localeCompare(vb); // ASC
      return String(a.detailId || "").localeCompare(String(b.detailId || ""));
    });
    return rows;
  }, [filteredCols, sortKey, sortDir]);

  /** Gom theo ngày đặt lệnh (V21) — fallback ngày giao; dùng filteredCols + sort */
  const displayGroups = useMemo(() => {
    if (!groupByDate) return [{ key: "all", items: sortedFiltered }];
    const byDate: Record<string, Delivery[]> = {};
    for (const d of sortedFiltered) {
      const key = d.orderDate || d.deliveryDate || "—";
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(d);
    }
    return Object.keys(byDate)
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, items: byDate[k] }));
  }, [sortedFiltered, groupByDate]);


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

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={() => setColOpen(true)}
          className="px-3 py-2.5 text-xs font-bold rounded-xl bg-white border-2 border-slate-300 text-slate-800 shadow-sm active:scale-95"
        >
          Tùy chỉnh cột
        </button>
      </div>
<ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã GH, CT, khách, biển số…"
        statuses={[
          { key: "ALL", label: "Tất cả" },
          { key: "Mới tạo", label: "Mới tạo" },
          { key: "Đặt hàng", label: "Đặt hàng" },
          { key: "Đã nhận", label: "Đã nhận" },
          { key: "Đang giao", label: "Đang giao" },
          { key: "Hoàn thành", label: "Hoàn thành" },
          { key: "Hủy xe", label: "Hủy xe" },
          { key: "Xóa xe", label: "Xóa xe" },
        ]}
        selectedStatuses={statuses}
        onToggleStatus={(k) => setStatuses((s) => toggleStatus(s, k))}
        groupByDate={groupByDate}
        onGroupByDate={setGroupByDate}
        countLabel={`${sortedFiltered?.length ?? filteredCols.length}/${items.length}`}
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
          {/* Mobile cards — parity V21 + tùy cột */}
          <div className="md:hidden space-y-3 pb-24">
            {displayGroups.map((g) => (
              <div key={g.key} className="space-y-2.5">
                {groupByDate && (
                  <div className={DATE_GROUP_HEADER + " flex items-center gap-2"}>
                    <span>📅</span>
                    <span className="flex-1">
                      Ngày đặt lệnh: {fmtDateVN(g.key)}
                      <span className="ml-1.5 text-xs font-normal text-slate-300">
                        ({g.items.length})
                      </span>
                    </span>
                  </div>
                )}
                {g.items.map((d) => {
                  const label = actionLabel(d);
                  const viewOnly = isViewOnly(d);
                  const st = d.detailStatus || "";
                  const khName = d.customerName || d.customerId || "—";
                  const planned = Number(d.plannedQty) || 0;
                  const actual = Number(d.actualQty) || 0;
                  const diff = Math.round((planned - actual) * 1000) / 1000;
                  const show = (key: string) => isColVisible(visibleCols, key);
                  const row = (k: string, v: string | number, vClass = "") => (
                    <div className="flex items-start justify-between gap-3 py-1 text-sm">
                      <span className="text-[13px] opacity-80 shrink-0">{k}</span>
                      <span className={`text-right font-medium leading-snug break-words max-w-[62%] ${vClass}`}>
                        {v}
                      </span>
                    </div>
                  );
                  return (
                    <div
                      key={d.deliveryId}
                      className={`rounded-2xl border-2 p-3.5 shadow-sm ${statusRowClass(st)}`}
                    >
                      {show("orderDate") &&
                        row("Ngày đặt", fmtDateVN(d.orderDate || d.deliveryDate || ""))}
                      {show("plate") && (
                        <div className="flex items-center justify-between gap-2 py-1">
                          <span className="text-[13px] opacity-80">Biển số</span>
                          <span className={PLATE_CLASS}>
                            {d.vehiclePlate || d.vehicleId || "—"}
                          </span>
                        </div>
                      )}
                      {show("id") &&
                        row("ID Giao hàng", d.deliveryId, "font-mono text-[12px]")}
                      {show("product") &&
                        (d.productName || d.productId) &&
                        row("Hàng hóa", d.productName || d.productId || "")}
                      {show("recvDate") &&
                        row(
                          "Ngày nhận",
                          d.receivedDate ? fmtDateVN(d.receivedDate) : "—"
                        )}
                      {show("customer") &&
                        row(
                          "Tên khách hàng",
                          khName,
                          /chưa xác định|chua xac dinh/i.test(khName)
                            ? "text-amber-900 font-semibold"
                            : ""
                        )}
                      {show("planned") &&
                        row(
                          "KH giao",
                          planned.toLocaleString("vi-VN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        )}
                      {show("date") &&
                        row(
                          "Ngày giao",
                          d.deliveryDate ? fmtDateVN(d.deliveryDate) : "—"
                        )}
                      {show("actual") &&
                        row(
                          "Thực giao",
                          actual.toLocaleString("vi-VN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        )}
                      {show("diff") &&
                        row(
                          "Chênh lệch",
                          diff.toLocaleString("vi-VN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }),
                          diff > 0.001
                            ? "text-emerald-700 font-bold"
                            : diff < -0.001
                              ? "text-red-700 font-bold"
                              : ""
                        )}
                      {show("status") && (
                        <div className="flex items-center justify-between gap-2 py-1">
                          <span className="text-[13px] opacity-80">Trạng thái</span>
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusBadgeClass(st)}`}
                          >
                            {statusLabelVN(st)}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-black/10">
                        <span className="text-[13px] opacity-80">Hành động</span>
                        <button
                          type="button"
                          onClick={() =>
                            setModalTarget({
                              delivery: d,
                              mode: modeFromDelivery(d),
                            })
                          }
                          className={`min-h-[40px] min-w-[88px] px-4 rounded-xl text-sm font-bold border-2 shadow-sm active:scale-[0.98] ${
                            viewOnly
                              ? "bg-white/90 text-slate-700 border-slate-400"
                              : label === "Sửa"
                                ? "bg-white/90 text-slate-800 border-slate-500"
                                : "bg-sky-600 text-white border-sky-700"
                          }`}
                        >
                          {label}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {filteredCols.length === 0 && !err && (
              <div className="text-center py-12 text-slate-400 text-sm">
                Không có lượt giao
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-xs">
                    {visibleCols.map((c) => (
                      <HeaderFilterTh
                        key={c.key}
                        label={c.label}
                        align={
                          c.align ||
                          (["planned", "actual", "actions"].includes(c.key)
                            ? "right"
                            : "left")
                        }
                        filterable={!!c.filterable}
                        values={colUnique[c.key] || []}
                        selected={valFilters[c.key] || []}
                        onChange={(next) =>
                          setValFilters((f) => ({ ...f, [c.key]: next }))
                        }
                        sortable={c.key !== "actions"}
                        sortDir={sortKey === c.key ? sortDir : null}
                        onSort={() => {
                          const n = cycleSort(c.key, sortKey, sortDir);
                          setSortKey(n.key);
                          setSortDir(n.dir);
                        }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayGroups.map((g) => (
                    <React.Fragment key={g.key}>
                      {groupByDate && (
                        <tr className="bg-[#1a3a5c] text-white">
                          <td colSpan={Math.max(visibleCols.length, 1)} className="px-3 py-2 text-xs font-medium">
                            📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                            <span className="ml-2 opacity-70">({g.items.length} lượt)</span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((d) => (
                        <tr key={d.deliveryId} className={`border-t border-slate-200/80 ${statusRowClass(d.detailStatus || "")}`}>
                          {visibleCols.map((c) => {
                            if (c.key === "id")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-mono text-xs">
                                  {d.deliveryId}
                                </td>
                              );
                            if (c.key === "detailId")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-blue-700 text-xs font-mono">
                                  {d.detailId}
                                </td>
                              );
                            if (c.key === "plate")
                              return (
                                <td key={c.key} className="px-3 py-2.5">
                                  <PlateBadge plate={d.vehiclePlate} />
                                </td>
                              );
                            if (c.key === "status")
                              return (
                                <td key={c.key} className="px-3 py-2.5">
                                  <StatusBadge status={statusLabelVN(d.detailStatus || "")} />
                                </td>
                              );
                            if (c.key === "customer")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-medium">
                                  {d.customerName || d.customerDetail || d.customerId}
                                </td>
                              );
                            if (c.key === "planned")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">
                                  {d.plannedQty.toFixed(2)}
                                </td>
                              );
                            if (c.key === "actual")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                                  {d.actualQty?.toFixed(2) ?? "—"}
                                </td>
                              );
                            if (c.key === "diff") {
                              const planned = Number(d.plannedQty) || 0;
                              const actual = Number(d.actualQty) || 0;
                              const v = actual - planned;
                              const color =
                                v > 0.005
                                  ? "text-green-700"
                                  : v < -0.005
                                    ? "text-red-700"
                                    : "text-slate-700";
                              return (
                                <td key={c.key} className={`px-3 py-2.5 text-right tabular-nums font-bold ${color}`}>
                                  {v.toFixed(2)}
                                </td>
                              );
                            }
                            if (c.key === "product")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-medium">
                                  {d.productName || d.productId || "—"}
                                </td>
                              );
                            if (c.key === "orderDate")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-xs">
                                  {d.orderDate ? fmtDateVN(d.orderDate) : "—"}
                                </td>
                              );
                            if (c.key === "recvDate")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-xs tabular-nums">
                                  {d.receivedDate ? fmtDateVN(d.receivedDate) : "—"}
                                </td>
                              );
                            if (c.key === "customerId")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-mono text-xs">
                                  {d.customerId}
                                </td>
                              );
                            if (c.key === "customerDetail")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-xs">
                                  {d.customerDetail || "—"}
                                </td>
                              );
                            if (c.key === "productId")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-mono text-xs">
                                  {d.productId || "—"}
                                </td>
                              );
                            if (c.key === "vehicleId")
                              return (
                                <td key={c.key} className="px-3 py-2.5 font-mono text-xs">
                                  {d.vehicleId || "—"}
                                </td>
                              );
                            if (c.key === "actualRecv")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">
                                  {(Number(d.actualReceived) || 0).toFixed(2)}
                                </td>
                              );
                            if (c.key === "date")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-xs text-slate-600">
                                  {d.deliveryDate ? fmtDateVN(d.deliveryDate) : "—"}
                                </td>
                              );
                            if (c.key === "actions")
                              return (
                                <td key={c.key} className="px-3 py-2.5 text-right">
                                  <button
                                    onClick={() => {
                                      setModalTarget({
                                        delivery: d,
                                        mode: modeFromDelivery(d),
                                      });
                                    }}
                                    className={`px-2.5 py-1 text-[11px] font-bold rounded border shadow-sm ${
                                      isViewOnly(d)
                                        ? "bg-white text-slate-600 border-slate-300"
                                        : actionLabel(d) === "Sửa"
                                          ? "bg-white text-slate-700 border-slate-300"
                                          : "bg-sky-500 text-white border-sky-600"
                                    }`}
                                  >
                                    {actionLabel(d)}
                                  </button>
                                </td>
                              );
                            return <td key={c.key} />;
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredCols.length === 0 && !err && (
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
      {modalTarget && (
        <DeliveryEditorModal
          mode={modalTarget.mode}
          summary={summaryFromDelivery(modalTarget.delivery)}
          onClose={() => setModalTarget(null)}
          onSaved={() => load(page)}
        />
      )}
      <ColumnCustomizer
        open={colOpen}
        tabKey="delivery"
        columns={DELIVERY_COLUMNS}
        onClose={() => setColOpen(false)}
        onApply={setColState}
      />
    </div>
  );
}
