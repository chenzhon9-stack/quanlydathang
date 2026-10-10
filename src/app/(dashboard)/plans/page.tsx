"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { statusRowClass } from "@/lib/status-styles";
import {
  ACTION,
  clientHasAny,
  readClientUser,
} from "@/lib/nav-access";
import type { ProductionPlan } from "@/types";

type PlanRow = ProductionPlan & { productNames?: string[] };

function fmtNum(n?: number | null, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
  });
}

function fmtDate(ymd?: string) {
  if (!ymd) return "—";
  const s = ymd.slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function progressPct(p: PlanRow) {
  if (!p.plannedQuantity) return 0;
  return Math.round((Number(p.actualQuantity || 0) / p.plannedQuantity) * 1000) / 10;
}

function statusTone(st: string) {
  if (st.includes("Hoàn")) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (st.includes("Hủy")) return "bg-red-100 text-red-700 border-red-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

/** Màu nền card mobile theo tiến độ — giống bản GAS (cam → vàng nhạt → xanh). */
function planCardTone(p: PlanRow, pct: number) {
  const st = String(p.status || "");
  if (st.includes("Hủy")) return "bg-red-50 border-red-200";
  if (st.includes("Hoàn") || pct >= 100) return "bg-green-100 border-green-200";
  if (pct >= 70) return "bg-[#fff7e0] border-amber-200";
  return "bg-[#ffe9d2] border-orange-200";
}

/** Chip trạng thái dạng tô nền (GAS): đang thực hiện = cam. */
function planStatusChip(st: string) {
  if (st.includes("Hoàn")) return "bg-green-400";
  if (st.includes("Hủy")) return "bg-red-300";
  return "bg-amber-500";
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function IconEye() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg {...iconProps}>
      <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

export default function PlansPage() {
  const user = readClientUser();
  const canEdit = clientHasAny(user, [...ACTION.planUpdate, "KHSL_UPDATE", "*"]);

  const [items, setItems] = useState<PlanRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const pageSize = 50;

  // Filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [nccOpen, setNccOpen] = useState(false);
  const filterBarRef = useRef<HTMLDivElement | null>(null);

  // Đóng multi-check khi click ra ngoài
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = filterBarRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setStatusOpen(false);
        setNccOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const [nccOptions, setNccOptions] = useState<Array<{ id: string; name: string }>>([]);

  // Modals
  const [viewPlan, setViewPlan] = useState<PlanRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    programName: "",
    supplierId: "",
    productIds: [] as string[],
    fromDate: "",
    toDate: "",
    plannedQuantity: "",
    status: "Đang thực hiện",
    note: "",
  });
  const [hhOptions, setHhOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  const loadNcc = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch("/api/v1/masters?type=NCC", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        const rows = (json.data.items || []) as Record<string, string>[];
        setNccOptions(
          rows
            .map((r) => ({
              id: String(r.MaNCC || "").trim(),
              name: String(r.TenNCC || r.MaNCC || "").trim(),
            }))
            .filter((x) => x.id)
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadHh = useCallback(async (ncc: string) => {
    const token = localStorage.getItem("token");
    if (!token || !ncc) {
      setHhOptions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/planning/products?supplierId=${encodeURIComponent(ncc)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.success) setHhOptions(json.data.items || []);
      else setHhOptions([]);
    } catch {
      setHhOptions([]);
    }
  }, []);

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
        if (fromDate) qs.set("fromDate", fromDate);
        if (toDate) qs.set("toDate", toDate);
        if (statuses.length) qs.set("status", statuses.join(";"));
        if (supplierIds.length) qs.set("supplierId", supplierIds.join(";"));
        if (q.trim()) qs.set("q", q.trim());

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
    [year, fromDate, toDate, statuses, supplierIds, q]
  );

  useEffect(() => {
    loadNcc();
  }, [loadNcc]);

  useEffect(() => {
    load(1);
  }, [load]);

  useEffect(() => {
    if (form.supplierId) loadHh(form.supplierId);
    else setHhOptions([]);
  }, [form.supplierId, loadHh]);

  function openCreate() {
    setEditId(null);
    setForm({
      programName: "",
      supplierId: "",
      productIds: [],
      fromDate: "",
      toDate: "",
      plannedQuantity: "",
      status: "Đang thực hiện",
      note: "",
    });
    setFormErr("");
    setEditOpen(true);
  }

  function openEdit(p: PlanRow) {
    setEditId(p.id);
    setForm({
      programName: p.programName || "",
      supplierId: p.supplierId || "",
      productIds: [...(p.productIds || [])],
      fromDate: (p.fromDate || "").slice(0, 10),
      toDate: (p.toDate || "").slice(0, 10),
      plannedQuantity: String(p.plannedQuantity ?? ""),
      status: p.status || "Đang thực hiện",
      note: p.note || "",
    });
    setFormErr("");
    setEditOpen(true);
  }

  async function saveForm() {
    setFormErr("");
    setBusy(true);
    const token = localStorage.getItem("token");
    try {
      const body = {
        year,
        programName: form.programName.trim(),
        supplierId: form.supplierId,
        productIds: form.productIds,
        fromDate: form.fromDate,
        toDate: form.toDate,
        plannedQuantity: Number(String(form.plannedQuantity).replace(",", ".")),
        status: form.status,
        note: form.note,
      };
      const url = editId
        ? `/api/v1/planning/${encodeURIComponent(editId)}`
        : "/api/v1/planning";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setFormErr(json.error?.message || "Lưu thất bại");
        return;
      }
      setEditOpen(false);
      load(page);
    } catch {
      setFormErr("Không kết nối API");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPlan(p: PlanRow) {
    if (!confirm(`Hủy kế hoạch ${p.id}?`)) return;
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        `/api/v1/planning/${encodeURIComponent(p.id)}?year=${year}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Hủy thất bại");
        return;
      }
      load(page);
    } catch {
      alert("Không kết nối API");
    }
  }

  function toggleProduct(id: string) {
    setForm((f) => {
      const has = f.productIds.includes(id);
      return {
        ...f,
        productIds: has
          ? f.productIds.filter((x) => x !== id)
          : [...f.productIds, id],
      };
    });
  }

  const productLabel = (p: PlanRow) =>
    (p.productNames && p.productNames.length
      ? p.productNames
      : p.productIds || []
    ).join(", ");

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Kế hoạch sản lượng
          </h2>
          <p className="text-xs text-slate-500">
            {total} kế hoạch · sheet KHSANLUONG
            {err ? ` · ${err}` : ""}
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
            className="px-3 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white"
          >
            Tải lại
          </button>
          {canEdit && (
            <button
              onClick={openCreate}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
            >
              + Thêm kế hoạch
            </button>
          )}
        </div>
      </div>

      {/* Filters — light theme */}
      <div ref={filterBarRef} className="rounded-xl border border-slate-200 bg-white p-3 md:p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs space-y-1">
            <span className="text-slate-600 font-medium">Từ ngày</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 bg-white"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-slate-600 font-medium">Đến ngày</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 bg-white"
            />
          </label>
          <div className="text-xs space-y-1 relative">
            <span className="text-slate-600 font-medium">Trạng thái</span>
            <button
              type="button"
              onClick={() => {
                setStatusOpen((v) => !v);
                setNccOpen(false);
              }}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-left text-slate-800 bg-white"
            >
              {statuses.length
                ? statuses.join(", ")
                : "Tất cả trạng thái (chọn nhiều)"}
            </button>
            {statusOpen && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg p-2 space-y-1">
                {["Đang thực hiện", "Hoàn thành", "Hủy"].map((s) => (
                  <label
                    key={s}
                    className="flex items-center gap-2 text-sm px-1 py-1 hover:bg-slate-50 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={statuses.includes(s)}
                      onChange={() =>
                        setStatuses((prev) =>
                          prev.includes(s)
                            ? prev.filter((x) => x !== s)
                            : [...prev, s]
                        )
                      }
                    />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr_auto] gap-3 items-end">
          <div className="text-xs space-y-1 relative">
            <span className="text-slate-600 font-medium">Nhà cung cấp</span>
            <button
              type="button"
              onClick={() => {
                setNccOpen((v) => !v);
                setStatusOpen(false);
              }}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-left text-slate-800 bg-white"
            >
              {supplierIds.length
                ? `${supplierIds.length} NCC đã chọn`
                : "Tất cả NCC (chọn nhiều)"}
            </button>
            {nccOpen && (
              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg p-2 space-y-1">
                {nccOptions.map((n) => (
                  <label
                    key={n.id}
                    className="flex items-center gap-2 text-sm px-1 py-1 hover:bg-slate-50 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={supplierIds.includes(n.id)}
                      onChange={() =>
                        setSupplierIds((prev) =>
                          prev.includes(n.id)
                            ? prev.filter((x) => x !== n.id)
                            : [...prev, n.id]
                        )
                      }
                    />
                    <span className="truncate">{n.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="text-xs space-y-1">
            <span className="text-slate-600 font-medium">
              Tìm kiếm{" "}
              <span className="text-slate-400 font-normal">
                (Và: + · Hoặc: ;)
              </span>
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="VD: bim + son; song lam"
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-800 bg-white"
            />
          </label>
          <button
            onClick={() => {
              setStatusOpen(false);
              setNccOpen(false);
              load(1);
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500"
          >
            Lọc
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Đang tải kế hoạch...
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {items.map((p) => {
              const pct = progressPct(p);
              const cancelled = String(p.status).includes("Hủy");
              const rows: [string, string][] = [
                ["Mã KH", p.id],
                ["Chương trình", p.programName],
                ["NCC", p.supplierName || p.supplierId],
                ["Sản phẩm", productLabel(p)],
                ["Từ ngày", fmtDate(p.fromDate)],
                ["Đến ngày", fmtDate(p.toDate)],
                ["Kế hoạch", fmtNum(p.plannedQuantity)],
                ["Thực tế", fmtNum(p.actualQuantity)],
              ];
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl border p-2 shadow-sm ${planCardTone(p, pct)}`}
                >
                  <div className="border border-slate-300/70 rounded-md overflow-hidden text-[15px] leading-snug">
                    {rows.map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-3 px-3 py-2 border-b border-slate-300/70 last:border-b-0"
                      >
                        <span className="shrink-0 font-semibold text-slate-400">
                          {label}
                        </span>
                        <span className="text-right text-slate-900 break-words min-w-0">
                          {value || "—"}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-300/70">
                      <span className="shrink-0 font-semibold text-slate-400">%</span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {pct}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-300/70">
                      <span className="shrink-0 font-semibold text-slate-400">
                        Trạng thái
                      </span>
                      <span
                        className={`px-1.5 py-0.5 text-[15px] text-black ${planStatusChip(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-300/70">
                      <span className="shrink-0 font-semibold text-slate-400">
                        Hành động
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Xem"
                          aria-label="Xem"
                          onClick={() => setViewPlan(p)}
                          className="h-9 w-12 grid place-items-center rounded-lg bg-white border border-slate-300 text-black active:opacity-80"
                        >
                          <IconEye />
                        </button>
                        {canEdit && !cancelled && (
                          <>
                            <button
                              type="button"
                              title="Sửa"
                              aria-label="Sửa"
                              onClick={() => openEdit(p)}
                              className="h-9 w-12 grid place-items-center rounded-lg bg-white border border-slate-300 text-black active:opacity-80"
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              title="Hủy kế hoạch"
                              aria-label="Hủy kế hoạch"
                              onClick={() => cancelPlan(p)}
                              className="h-9 w-12 grid place-items-center rounded-lg bg-red-500 border border-red-600 text-black active:opacity-80"
                            >
                              <IconTrash />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!items.length && (
              <div className="text-center py-10 text-slate-400 text-sm">
                Không có kế hoạch
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-sky-500 text-white text-left text-xs uppercase tracking-wide">
                  <th className="px-3 py-2.5">Mã KH</th>
                  <th className="px-3 py-2.5">Chương trình</th>
                  <th className="px-3 py-2.5">Nhà cung cấp</th>
                  <th className="px-3 py-2.5">Sản phẩm</th>
                  <th className="px-3 py-2.5">Từ ngày</th>
                  <th className="px-3 py-2.5">Đến ngày</th>
                  <th className="px-3 py-2.5 text-right">Kế hoạch (tấn)</th>
                  <th className="px-3 py-2.5 text-right">Thực hiện (tấn)</th>
                  <th className="px-3 py-2.5">% HT</th>
                  <th className="px-3 py-2.5">Trạng thái</th>
                  <th className="px-3 py-2.5 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p, idx) => {
                  const pct = progressPct(p);
                  const barColor =
                    pct >= 100
                      ? "bg-emerald-500"
                      : pct >= 70
                        ? "bg-amber-400"
                        : "bg-red-400";
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-slate-100 ${
                        idx % 2 ? "bg-slate-50/80" : "bg-white"
                      } ${statusRowClass(p.status)}`}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {p.id}
                      </td>
                      <td className="px-3 py-2.5 max-w-[12rem]">
                        {p.programName}
                      </td>
                      <td className="px-3 py-2.5 max-w-[11rem]">
                        {p.supplierName || p.supplierId}
                      </td>
                      <td className="px-3 py-2.5 max-w-[14rem] text-xs text-slate-600">
                        {productLabel(p)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {fmtDate(p.fromDate)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {fmtDate(p.toDate)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fmtNum(p.plannedQuantity)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fmtNum(p.actualQuantity)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 min-w-[5rem]">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className={`h-full ${barColor}`}
                              style={{
                                width: `${Math.min(100, pct)}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 w-9 text-right">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${statusTone(p.status)}`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <button
                            onClick={() => setViewPlan(p)}
                            className="px-2 py-1 text-[11px] rounded bg-slate-200 text-slate-700"
                            title="Xem"
                          >
                            Xem
                          </button>
                          {canEdit && !String(p.status).includes("Hủy") && (
                            <>
                              <button
                                onClick={() => openEdit(p)}
                                className="px-2 py-1 text-[11px] rounded bg-blue-600 text-white"
                              >
                                Sửa
                              </button>
                              <button
                                onClick={() => cancelPlan(p)}
                                className="px-2 py-1 text-[11px] rounded bg-red-500 text-white"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!items.length && (
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

      {/* View modal */}
      {viewPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800 pr-4">
                {viewPlan.programName}
              </h3>
              <button
                onClick={() => setViewPlan(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Mã kế hoạch</div>
                  <div className="font-mono font-medium">{viewPlan.id}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Trạng thái</div>
                  <span
                    className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${statusTone(viewPlan.status)}`}
                  >
                    {viewPlan.status}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Nhà cung cấp</div>
                  <div>{viewPlan.supplierName || viewPlan.supplierId}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Người tạo</div>
                  <div className="text-xs break-all">
                    {viewPlan.createdBy || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Từ ngày</div>
                  <div>{fmtDate(viewPlan.fromDate)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Đến ngày</div>
                  <div>{fmtDate(viewPlan.toDate)}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">
                  Hàng hóa áp dụng
                </div>
                <div className="text-slate-700">{productLabel(viewPlan)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 border p-3">
                  <div className="text-xs text-slate-500">Kế hoạch</div>
                  <div className="text-lg font-bold">
                    {fmtNum(viewPlan.plannedQuantity)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 border p-3">
                  <div className="text-xs text-slate-500">Thực tế</div>
                  <div className="text-lg font-bold">
                    {fmtNum(viewPlan.actualQuantity)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 border p-3">
                  <div className="text-xs text-slate-500">Chênh lệch</div>
                  <div
                    className={`text-lg font-bold ${
                      (viewPlan.plannedQuantity || 0) -
                        (viewPlan.actualQuantity || 0) >
                      0
                        ? "text-red-600"
                        : "text-emerald-600"
                    }`}
                  >
                    {fmtNum(
                      (viewPlan.plannedQuantity || 0) -
                        (viewPlan.actualQuantity || 0)
                    )}
                  </div>
                </div>
              </div>
              <div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full ${
                      progressPct(viewPlan) >= 100
                        ? "bg-emerald-500"
                        : "bg-sky-500"
                    }`}
                    style={{
                      width: `${Math.min(100, progressPct(viewPlan))}%`,
                    }}
                  />
                </div>
                <div className="text-center text-xs text-slate-500 mt-1">
                  {progressPct(viewPlan)}%
                </div>
              </div>
              {viewPlan.note && (
                <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
                  <span className="font-medium">Ghi chú: </span>
                  {viewPlan.note}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-slate-800">
                {editId ? "Sửa kế hoạch sản lượng" : "Thêm kế hoạch sản lượng"}
              </h3>
              <button
                onClick={() => setEditOpen(false)}
                className="text-slate-400"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              {formErr && (
                <div className="text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5">
                  {formErr}
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">Tên chương trình</span>
                <input
                  value={form.programName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, programName: e.target.value }))
                  }
                  placeholder="VD: Kế hoạch xi măng quý 3/2026"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">Nhà cung cấp</span>
                <select
                  value={form.supplierId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      supplierId: e.target.value,
                      productIds: [],
                    }))
                  }
                  className="w-full border rounded-lg px-3 py-2"
                  disabled={!!editId}
                >
                  <option value="">Chọn NCC...</option>
                  {nccOptions.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-1">
                <span className="text-xs text-slate-600">
                  Hàng hóa áp dụng (chọn 1 hoặc nhiều)
                </span>
                {!form.supplierId ? (
                  <div className="text-xs text-slate-400 border rounded-lg px-3 py-2 bg-slate-50">
                    Vui lòng chọn nhà cung cấp trước.
                  </div>
                ) : (
                  <div className="border rounded-lg max-h-36 overflow-y-auto p-2 space-y-1">
                    {hhOptions.map((h) => (
                      <label
                        key={h.id}
                        className="flex items-center gap-2 text-xs hover:bg-slate-50 rounded px-1 py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={form.productIds.includes(h.id)}
                          onChange={() => toggleProduct(h.id)}
                        />
                        <span>
                          {h.name}{" "}
                          <span className="text-slate-400">({h.id})</span>
                        </span>
                      </label>
                    ))}
                    {!hhOptions.length && (
                      <div className="text-xs text-slate-400">
                        Không có hàng hóa
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-600">Từ ngày</span>
                  <input
                    type="date"
                    value={form.fromDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fromDate: e.target.value }))
                    }
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-600">Đến ngày</span>
                  <input
                    type="date"
                    value={form.toDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, toDate: e.target.value }))
                    }
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">
                  Sản lượng kế hoạch (tấn)
                </span>
                <input
                  value={form.plannedQuantity}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      plannedQuantity: e.target.value,
                    }))
                  }
                  inputMode="decimal"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">Trạng thái</span>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value }))
                  }
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option>Đang thực hiện</option>
                  <option>Hoàn thành</option>
                  <option>Hủy</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">Ghi chú</span>
                <textarea
                  value={form.note}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, note: e.target.value }))
                  }
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </label>
            </div>
            <div className="flex gap-2 p-4 border-t">
              <button
                onClick={() => setEditOpen(false)}
                className="flex-1 py-2.5 rounded-lg border text-sm font-medium"
                disabled={busy}
              >
                Hủy
              </button>
              <button
                onClick={saveForm}
                disabled={busy}
                className="flex-1 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Đang lưu..." : "Lưu kế hoạch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
