"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListToolbar,
  toggleStatus,
  matchStatuses,
  matchSearch,
} from "@/components/ListToolbar";
import { StatusBadge, PlateBadge } from "@/components/StatusBadge";
import { ActionPrompt, apiPost, apiPatch } from "@/components/ActionPrompt";
import { downloadExcelHtml } from "@/lib/export-excel";
import { MasterPicker } from "@/components/MasterPicker";
import { DecimalInput, parseDecimalVN, formatDecimalVN } from "@/components/DecimalInput";
import { receiveDateBounds, clampYmd } from "@/lib/business-rules";
import {
  DeliveryEditorModal,
  summaryFromDetail,
} from "@/components/DeliveryEditorModal";
import { statusRowClass } from "@/lib/status-styles";
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
import { DETAILS_COLUMN_DEFS } from "@/lib/column-definitions";
import type { Delivery, OrderDetail } from "@/types";


const DETAIL_COLUMNS = DETAILS_COLUMN_DEFS;

const STATUS_LABEL: Record<string, string> = {
  NEW: "Mới tạo",
  ORDERED: "Đặt hàng",
  RECEIVED: "Đã nhận",
  DELIVERING: "Đang giao",
  DONE: "Hoàn thành",
  CANCEL: "Hủy xe",
  DELETE: "Xóa xe",
};

function fmtDateVN(ymd?: string) {
  if (!ymd || ymd === "—" || ymd === "all") return "—";
  const p = ymd.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return ymd;
}

function fmtNum(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function transportSub(d: OrderDetail) {
  const t = (d.transportTypeName || d.transportTypeId || "").toLowerCase();
  if (t.includes("npp") || t.includes("nhà phân")) return "NPP vận chuyển";
  if (t.includes("khách") || t.includes("kh ")) return "KH vận chuyển";
  if (t.includes("ncc")) return "NCC vận chuyển";
  if (t.includes("thuê")) return "Thuê ngoài";
  return d.transportTypeName || "";
}

function tonConLai(d: OrderDetail) {
  const nhan = Number(d.actualReceived) || 0;
  const giao = Number(d.actualDelivered) || 0;
  if (nhan <= 0) return Number(d.quantity) || 0;
  return Math.max(0, Math.round((nhan - giao) * 1000) / 1000);
}

/* ─── Modal shell ─── */
function ModalShell({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${
          wide ? "max-w-3xl" : "max-w-md"
        } overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-snug">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-slate-100 bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] font-bold text-slate-600 mb-1">{label}</div>
      <div className="px-3 py-2.5 rounded-lg bg-slate-100 text-slate-800 text-sm border border-slate-200">
        {value || "—"}
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  readOnly,
  min,
  max,
  hint,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  readOnly?: boolean;
  min?: string;
  max?: string;
  hint?: string;
}) {
  const cls = `w-full px-3 py-2.5 rounded-lg text-sm border ${
    readOnly
      ? "bg-slate-100 border-slate-200 text-slate-700"
      : "bg-white border-slate-300 text-slate-900 focus:ring-2 focus:ring-sky-400 focus:outline-none"
  }`;
  return (
    <div>
      <div className="text-[12px] font-bold text-slate-600 mb-1">{label}</div>
      {type === "number" && !readOnly ? (
        <DecimalInput
          value={value}
          onValueChange={(display) => onChange?.(display)}
          className={cls + " tabular-nums"}
        />
      ) : (
        <input
          type={type === "number" ? "text" : type}
          value={value}
          readOnly={readOnly}
          min={min}
          max={max}
          onChange={(e) => {
            let v = e.target.value;
            if (type === "date") v = clampYmd(v, min, max);
            onChange?.(v);
          }}
          className={cls}
        />
      )}
      {hint ? (
        <div className="text-[11px] text-slate-500 mt-1">{hint}</div>
      ) : null}
    </div>
  );
}

/* ─── Actions ─── */
type Handlers = {
  onReceive: (d: OrderDetail) => void;
  onEdit: (d: OrderDetail) => void;
  onPlan: (d: OrderDetail) => void;
  onDeliver: (d: OrderDetail) => void;
  onView: (d: OrderDetail) => void;
  onCancel: (d: OrderDetail, mode: "cancel" | "delete") => void;
};

function DetailActions({ d, h }: { d: OrderDetail; h: Handlers }) {
  const st = d.status;
  const btn =
    "px-2.5 py-1 text-[11px] font-bold rounded-md border shadow-sm whitespace-nowrap";
  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {st === "ORDERED" && (
        <button type="button" onClick={() => h.onReceive(d)} className={`${btn} bg-emerald-500 text-white border-emerald-600`}>
          Nhận
        </button>
      )}
      {(st === "ORDERED" || st === "NEW") && (
        <>
          <button type="button" onClick={() => h.onEdit(d)} className={`${btn} bg-white text-slate-700 border-slate-300`}>
            Sửa hàng
          </button>
          <button type="button" onClick={() => h.onPlan(d)} className={`${btn} bg-white text-slate-700 border-slate-300`}>
            Sửa KH
          </button>
          <button
            type="button"
            onClick={() => h.onCancel(d, st === "NEW" ? "delete" : "cancel")}
            className={`${btn} bg-red-500 text-white border-red-600`}
          >
            {st === "NEW" ? "Xóa" : "Hủy"}
          </button>
        </>
      )}
      {(st === "RECEIVED" || st === "DELIVERING") && (
        <button type="button" onClick={() => h.onDeliver(d)} className={`${btn} bg-sky-500 text-white border-sky-600`}>
          Giao
        </button>
      )}
      {st === "DONE" && (
        <button type="button" onClick={() => h.onView(d)} className={`${btn} bg-white text-slate-600 border-slate-300`}>
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
  const [colOpen, setColOpen] = useState(false);
  const [colState, setColState] = useState<ColumnState>(() =>
    loadColumnState("details", DETAIL_COLUMNS)
  );
  const [valFilters, setValFilters] = useState<Record<string, string[]>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const [statuses, setStatuses] = useState<string[]>(["ALL"]);
  const [search, setSearch] = useState("");
  const [groupByDate, setGroupByDate] = useState(true);
  const pageSize = 100;

  const [receiveTarget, setReceiveTarget] = useState<OrderDetail | null>(null);
  const [editTarget, setEditTarget] = useState<OrderDetail | null>(null);
  const [deliveryTarget, setDeliveryTarget] = useState<{
    detail: OrderDetail;
    mode: "plan" | "real" | "view";
  } | null>(null);
  const [deliveryRows, setDeliveryRows] = useState<Delivery[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // edit form state
  const [editProduct, setEditProduct] = useState("");
  const [editProductId, setEditProductId] = useState("");
  const [editRegion, setEditRegion] = useState("");
  const [editRegionId, setEditRegionId] = useState("");
  const [editNote, setEditNote] = useState("");

  // receive form
  const [recvQty, setRecvQty] = useState("");
  const [recvDate, setRecvDate] = useState("");

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
        setErr(json.error?.message || "Lỗi tải chi tiết");
        setItems([]);
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

  async function openDeliveryModal(d: OrderDetail, mode: "plan" | "real" | "view") {
    setDeliveryTarget({ detail: d, mode });
    setDeliveryLoading(true);
    try {
      const token = localStorage.getItem("token");
      const qs = new URLSearchParams({
        detailId: d.detailId,
        year: String(new Date().getFullYear()),
        pageSize: "50",
      });
      const res = await fetch(`/api/v1/deliveries?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const rows: Delivery[] = json.data?.items || json.data || [];
      setDeliveryRows(rows);
      // editable copy for real mode
      if (mode === "real" && rows.length) {
        setDeliveryRows(
          rows.map((r) => ({
            ...r,
            actualQty: r.actualQty ?? 0,
            deliveryDate: r.deliveryDate || new Date().toISOString().slice(0, 10),
          }))
        );
      }
    } catch {
      setDeliveryRows([]);
    } finally {
      setDeliveryLoading(false);
    }
  }

  const handlers: Handlers = {
    onReceive: (d) => {
      setReceiveTarget(d);
      {
        const bounds = receiveDateBounds({
          orderDate: d.orderDate,
          isDuyenHa: !!d.isDuyenHa,
        });
        const def = clampYmd(
          (d.receivedDate || bounds.max || "").slice(0, 10),
          bounds.min,
          bounds.max
        );
        setRecvDate(def);
      }
      setRecvQty(String(d.quantity || ""));
      setRecvDate(new Date().toISOString().slice(0, 10));
    },
    onEdit: (d) => {
      setEditTarget(d);
      setEditProduct(d.productName || d.productId || "");
      setEditProductId(d.productId || "");
      setEditRegion(d.regionName || d.regionId || "");
      setEditRegionId(d.regionId || "");
      setEditNote(d.note || "");
    },
    onPlan: (d) => openDeliveryModal(d, "plan"),
    onDeliver: (d) => openDeliveryModal(d, "real"),
    onView: (d) => openDeliveryModal(d, "view"),
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
  };

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
        d.regionName || "",
        d.note || "",
      ].join(" ");
      return matchSearch(hay, search);
    });
  }, [items, statuses, search]);

  const visibleCols = useMemo(
    () => resolveColumns(DETAIL_COLUMNS, colState),
    [colState]
  );
  const colOn = (k: string) => visibleCols.some((c) => c.key === k);

  const filteredCols = useMemo(() => {
    return filtered.filter((d) => {
      const checks: [string, string][] = [
        ["status", STATUS_LABEL[d.status] || d.status || ""],
        ["product", d.productName || d.productId || ""],
        ["plate", d.vehiclePlate || d.vehicleId || ""],
        ["id", d.detailId || ""],
        ["orderId", d.orderId || ""],
        ["orderDate", String(d.orderDate || "").slice(0, 10)],
        ["supplier", d.supplierName || d.supplierId || ""],
        ["supplierId", d.supplierId || ""],
        ["region", d.regionName || d.regionId || ""],
        ["regionId", d.regionId || ""],
        ["vehicleId", d.vehicleId || ""],
        ["productId", d.productId || ""],
        ["htvt", d.transportTypeName || ""],
        ["htvtId", d.transportTypeId || ""],
        ["isDuyenHa", d.isDuyenHa ? "Có" : "Không"],
        ["recvDate", String(d.receivedDate || "").slice(0, 10)],
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
      plate: new Set(),
      id: new Set(),
      orderId: new Set(),
      orderDate: new Set(),
      supplier: new Set(),
      supplierId: new Set(),
      product: new Set(),
      productId: new Set(),
      region: new Set(),
      regionId: new Set(),
      vehicleId: new Set(),
      htvt: new Set(),
      htvtId: new Set(),
      isDuyenHa: new Set(),
      recvDate: new Set(),
      status: new Set(),
    };
    for (const d of filtered) {
      buckets.plate?.add(d.vehiclePlate || d.vehicleId || "");
      buckets.id?.add(d.detailId || "");
      buckets.orderId?.add(d.orderId || "");
      if (d.orderDate) buckets.orderDate?.add(String(d.orderDate).slice(0, 10));
      buckets.supplier?.add(d.supplierName || d.supplierId || "");
      buckets.supplierId?.add(d.supplierId || "");
      buckets.product?.add(d.productName || d.productId || "");
      buckets.productId?.add(d.productId || "");
      buckets.region?.add(d.regionName || d.regionId || "");
      buckets.regionId?.add(d.regionId || "");
      buckets.vehicleId?.add(d.vehicleId || "");
      if (d.transportTypeName) buckets.htvt?.add(d.transportTypeName);
      if (d.transportTypeId) buckets.htvtId?.add(d.transportTypeId);
      buckets.isDuyenHa?.add(d.isDuyenHa ? "Có" : "Không");
      if (d.receivedDate) buckets.recvDate?.add(String(d.receivedDate).slice(0, 10));
      buckets.status?.add(STATUS_LABEL[d.status] || d.status || "");
    }
    for (const [k, set] of Object.entries(buckets)) {
      map[k] = [...set].filter(Boolean).sort();
    }
    return map;
  }, [filtered]);


  function detailSortVal(d: OrderDetail, key: string): string | number {
    switch (key) {
      case "plate":
        return d.vehiclePlate || d.vehicleId || "";
      case "id":
        return d.detailId || "";
      case "orderId":
        return d.orderId || "";
      case "orderDate":
        return String(d.orderDate || "");
      case "supplier":
        return d.supplierName || d.supplierId || "";
      case "supplierId":
        return d.supplierId || "";
      case "product":
        return d.productName || d.productId || "";
      case "productId":
        return d.productId || "";
      case "region":
        return d.regionName || d.regionId || "";
      case "regionId":
        return d.regionId || "";
      case "vehicleId":
        return d.vehicleId || "";
      case "htvt":
        return d.transportTypeName || "";
      case "htvtId":
        return d.transportTypeId || "";
      case "isDuyenHa":
        return d.isDuyenHa ? 1 : 0;
      case "qty":
        return Number(d.quantity) || 0;
      case "recvDate":
        return String(d.receivedDate || "");
      case "actualRecv":
        return Number(d.actualReceived) || 0;
      case "actualDel":
        return Number(d.actualDelivered) || 0;
      case "remain":
        return Number(d.quantity || 0) - Number(d.actualReceived || 0);
      case "status":
        return STATUS_LABEL[d.status] || d.status || "";
      case "note":
        return d.note || "";
      default:
        return "";
    }
  }

  const sortedFiltered = useMemo(() => {
    const rows = [...filteredCols];
    if (sortKey && sortDir) {
      rows.sort((a, b) =>
        compareValues(detailSortVal(a, sortKey), detailSortVal(b, sortKey), sortDir)
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

  const displayGroups = useMemo(() => {
    if (!groupByDate) return [{ key: "all", items: sortedFiltered }];
    const byDate: Record<string, OrderDetail[]> = {};
    for (const d of sortedFiltered) {
      const key = d.orderDate || "—";
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(d);
    }
    return Object.keys(byDate)
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ key: k, items: byDate[k] }));
  }, [sortedFiltered, groupByDate]);

  async function submitReceive() {
    if (!receiveTarget) return;
    setBusy(true);
    try {
      const json = await apiPost(
        `/api/v1/order-details/${encodeURIComponent(receiveTarget.detailId)}/receive`,
        {
          actualReceived: parseDecimalVN(recvQty),
          receivedDate: recvDate,
          year: new Date().getFullYear(),
        }
      );
      if (!json.success) throw new Error(json.error?.message || "Lỗi nhận hàng");
      setReceiveTarget(null);
      load(page);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!editTarget) return;
    setBusy(true);
    try {
      // Ghi ghi chú + giữ mã HH/KV hiện tại (picker full sẽ bổ sung)
      const json = await apiPatch(
        `/api/v1/order-details/${encodeURIComponent(editTarget.detailId)}`,
        {
          note: editNote,
          productId: editProductId || undefined,
          regionId: editRegionId || undefined,
          year: new Date().getFullYear(),
        }
      );
      if (!json.success) throw new Error(json.error?.message || "Lỗi lưu");
      setEditTarget(null);
      load(page);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitDeliveryPlan() {
    if (!deliveryTarget) return;
    setBusy(true);
    try {
      const rows = deliveryRows.map((r) => ({
        deliveryId: r.deliveryId?.startsWith("NEW-") ? undefined : r.deliveryId,
        customerId: r.customerId,
        customerDetail: r.customerDetail || r.customerName || "",
        plannedQty: Number(r.plannedQty) || 0,
        note: r.note || "",
      }));
      if (!rows.length) {
        alert("Cần ít nhất 1 dòng khách kế hoạch");
        setBusy(false);
        return;
      }
      for (const r of rows) {
        if (!r.customerId) {
          alert("Chọn khách hàng cho mọi dòng");
          setBusy(false);
          return;
        }
        if (!(r.plannedQty > 0)) {
          alert("KH giao phải > 0");
          setBusy(false);
          return;
        }
      }
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/v1/order-details/${encodeURIComponent(deliveryTarget.detail.detailId)}/plan`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ rows, year: new Date().getFullYear() }),
        }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Lỗi lưu kế hoạch");
      setDeliveryTarget(null);
      load(page);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitDeliveryReal() {
    if (!deliveryTarget) return;
    setBusy(true);
    try {
      for (const row of deliveryRows) {
        const json = await apiPatch(
          `/api/v1/deliveries/${encodeURIComponent(row.deliveryId)}`,
          {
            actualQty: Number(row.actualQty) || 0,
            deliveryDate: row.deliveryDate,
            customerId: row.customerId,
            customerDetail: row.customerName || row.customerDetail || "",
            year: new Date().getFullYear(),
          }
        );
        if (!json.success)
          throw new Error(json.error?.message || `Lỗi GH ${row.deliveryId}`);
      }
      setDeliveryTarget(null);
      load(page);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const primaryBtn =
    "w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm disabled:opacity-50";

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Chi tiết xe</h2>
          <p className="text-xs text-slate-500">
            {total} chi tiết · gom theo ngày đặt lệnh
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
                `ChiTietXe_${new Date().toISOString().slice(0, 10)}.xls`,
                "ChiTiet",
                [
                  "Biển số",
                  "ID",
                  "Hàng hóa",
                  "KH đặt",
                  "Ngày nhận",
                  "Thực nhận",
                  "Thực giao",
                  "Tồn",
                  "TT",
                  "Ghi chú",
                ],
                filtered.map((d) => [
                  d.vehiclePlate || d.vehicleId,
                  d.detailId,
                  d.productName || d.productId,
                  d.quantity,
                  d.receivedDate || "",
                  d.actualReceived ?? 0,
                  d.actualDelivered ?? 0,
                  tonConLai(d),
                  STATUS_LABEL[d.status] || d.status,
                  d.note || "",
                ])
              );
            }}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white"
          >
            Xuất Excel
          </button>
          <button
            type="button"
            onClick={() => setColOpen(true)}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tùy chỉnh cột
          </button>
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm mã CT, đơn, xe, hàng…"
        statuses={[
          { key: "ALL", label: "Tất cả" },
          { key: "NEW", label: "Mới tạo" },
          { key: "ORDERED", label: "Đặt hàng" },
          { key: "RECEIVED", label: "Đã nhận" },
          { key: "DELIVERING", label: "Đang giao" },
          { key: "DONE", label: "Hoàn thành" },
          { key: "CANCEL", label: "Hủy xe" },
        ]}
        selectedStatuses={statuses}
        onToggleStatus={(k) => setStatuses((s) => toggleStatus(s, k))}
        groupByDate={groupByDate}
        onGroupByDate={setGroupByDate}
        countLabel={`${sortedFiltered.length}/${items.length}`}
      />

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {displayGroups.map((g) => (
              <div key={g.key} className="space-y-2">
                {groupByDate && (
                  <div className="sticky top-0 z-10 rounded-xl bg-[#1a3a5c] text-white px-3 py-2 text-sm font-semibold shadow">
                    📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                    <span className="ml-2 text-xs font-normal text-slate-300">
                      ({g.items.length})
                    </span>
                  </div>
                )}
                {g.items.map((d) => (
                  <div
                    key={d.detailId}
                    className={`rounded-2xl border border-slate-300/70 p-4 shadow-sm ${statusRowClass(d.status)}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <PlateBadge plate={d.vehiclePlate || d.vehicleId} />
                        <div className="text-[10px] mt-1 opacity-80">
                          {transportSub(d)}
                        </div>
                        <div className="text-xs font-mono mt-1 opacity-70">
                          {d.detailId}
                        </div>
                      </div>
                      <StatusBadge status={STATUS_LABEL[d.status] || d.status} />
                    </div>
                    <div className="mt-2 text-sm font-medium">
                      {d.productName || d.productId}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <div className="opacity-60">KH đặt</div>
                        <div className="font-semibold tabular-nums">{fmtNum(d.quantity)}</div>
                      </div>
                      <div>
                        <div className="opacity-60">Thực nhận</div>
                        <div className="font-semibold tabular-nums">{fmtNum(d.actualReceived)}</div>
                      </div>
                      <div>
                        <div className="opacity-60">Tồn</div>
                        <div className="font-semibold tabular-nums">{fmtNum(tonConLai(d))}</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-black/10">
                      <DetailActions d={d} h={handlers} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Desktop table — cột như V21 */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#d9e5f0] text-slate-800 text-xs">
                    {visibleCols.map((c) => (
                      <HeaderFilterTh
                        key={c.key}
                        label={c.label}
                        align={
                          c.align ||
                          (["qty", "actualRecv", "actualDel", "remain", "actions"].includes(
                            c.key
                          )
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
                          <td colSpan={11} className="px-3 py-2 text-xs font-bold">
                            📅 Ngày đặt lệnh: {fmtDateVN(g.key)}
                            <span className="ml-2 opacity-70 font-normal">
                              ({g.items.length} xe)
                            </span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((d) => (
                        <tr
                          key={d.detailId}
                          className={`border-t border-slate-200/80 ${statusRowClass(d.status)}`}
                        >
                          {visibleCols.map((c) => {
                            if (c.key === "plate")
                              return (
                                <td key={c.key} className="px-2 py-2">
                                  <PlateBadge plate={d.vehiclePlate || d.vehicleId} />
                                  {transportSub(d) && (
                                    <div className="text-[10px] opacity-70 mt-0.5">
                                      {transportSub(d)}
                                    </div>
                                  )}
                                </td>
                              );
                            if (c.key === "id")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px] text-blue-700">
                                  {d.detailId}
                                </td>
                              );
                            if (c.key === "orderDate")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs">
                                  {fmtDateVN(d.orderDate)}
                                </td>
                              );
                            if (c.key === "orderId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.orderId}
                                </td>
                              );
                            if (c.key === "supplier")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs">
                                  {d.supplierName || d.supplierId}
                                </td>
                              );
                            if (c.key === "region")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs">
                                  {d.regionName || d.regionId}
                                </td>
                              );

                            if (c.key === "vehicleId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.vehicleId}
                                </td>
                              );
                            if (c.key === "productId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.productId}
                                </td>
                              );
                            if (c.key === "regionId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.regionId}
                                </td>
                              );
                            if (c.key === "supplierId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.supplierId}
                                </td>
                              );
                            if (c.key === "htvtId")
                              return (
                                <td key={c.key} className="px-2 py-2 font-mono text-[11px]">
                                  {d.transportTypeId || "—"}
                                </td>
                              );
                            if (c.key === "htvt")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs">
                                  {d.transportTypeName || d.transportTypeId || "—"}
                                </td>
                              );
                            if (c.key === "isDuyenHa")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs font-semibold">
                                  {d.isDuyenHa ? (
                                    <span className="text-teal-700">Có</span>
                                  ) : (
                                    "Không"
                                  )}
                                </td>
                              );
                            if (c.key === "product")
                              return (
                                <td key={c.key} className="px-2 py-2 font-medium">
                                  {d.productName || d.productId}
                                </td>
                              );
                            if (c.key === "qty")
                              return (
                                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                                  {fmtNum(d.quantity)}
                                </td>
                              );
                            if (c.key === "recvDate")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs">
                                  {fmtDateVN(d.receivedDate)}
                                </td>
                              );
                            if (c.key === "actualRecv")
                              return (
                                <td key={c.key} className="px-2 py-2 text-right tabular-nums font-medium">
                                  {fmtNum(d.actualReceived ?? 0)}
                                </td>
                              );
                            if (c.key === "actualDel")
                              return (
                                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                                  {fmtNum(d.actualDelivered ?? 0)}
                                </td>
                              );
                            if (c.key === "remain")
                              return (
                                <td key={c.key} className="px-2 py-2 text-right tabular-nums font-semibold">
                                  {fmtNum(tonConLai(d))}
                                </td>
                              );
                            if (c.key === "status")
                              return (
                                <td key={c.key} className="px-2 py-2">
                                  <StatusBadge status={STATUS_LABEL[d.status] || d.status} />
                                </td>
                              );
                            if (c.key === "note")
                              return (
                                <td key={c.key} className="px-2 py-2 text-xs max-w-[120px] truncate">
                                  {d.note || ""}
                                </td>
                              );
                            if (c.key === "actions")
                              return (
                                <td key={c.key} className="px-2 py-2">
                                  <DetailActions d={d} h={handlers} />
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
              <div className="text-center py-12 text-slate-400 text-sm">
                Không có chi tiết
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

      {/* ── Modal Nhận hàng (V21) ── */}
      {receiveTarget && (
        <ModalShell
          title="Nhận hàng"
          onClose={() => !busy && setReceiveTarget(null)}
          footer={
            <button
              type="button"
              disabled={busy}
              onClick={submitReceive}
              className={primaryBtn}
            >
              {busy ? "Đang lưu…" : "XÁC NHẬN"}
            </button>
          }
        >
          <ReadonlyField
            label="Xe / hàng hóa"
            value={`${receiveTarget.vehiclePlate || receiveTarget.vehicleId} / ${receiveTarget.productName || receiveTarget.productId}`}
          />
          <ReadonlyField
            label="Số lượng kế hoạch đặt"
            value={fmtNum(receiveTarget.quantity)}
          />
          {(() => {
            const bounds = receiveDateBounds({
              orderDate: receiveTarget.orderDate,
              isDuyenHa: !!receiveTarget.isDuyenHa,
            });
            return (
              <InputField
                label="Ngày nhận"
                type="date"
                value={recvDate}
                min={bounds.min}
                max={bounds.max}
                onChange={setRecvDate}
                hint={
                  `Chọn từ ${bounds.min ? bounds.min.split("-").reverse().join("/") : "—"} đến ${bounds.max.split("-").reverse().join("/")}` +
                  (receiveTarget.isDuyenHa ? " (Duyên Hà: sau 14h tính ngày mai)" : "")
                }
              />
            );
          })()}
          <InputField
            label="Số lượng thực nhận"
            type="number"
            value={recvQty}
            onChange={setRecvQty}
          />
        </ModalShell>
      )}

      {/* ── Modal Sửa chi tiết (V21) ── */}
      {editTarget && (
        <ModalShell
          title="Sửa chi tiết"
          onClose={() => !busy && setEditTarget(null)}
          footer={
            <button
              type="button"
              disabled={busy}
              onClick={submitEdit}
              className={primaryBtn}
            >
              {busy ? "Đang lưu…" : "LƯU"}
            </button>
          }
        >
          <ReadonlyField
            label="Nhà cung cấp"
            value={editTarget.supplierName || editTarget.supplierId}
          />
          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">Hàng hóa</div>
            <MasterPicker
              type="HH"
              value={editProductId}
              displayName={editProduct}
              supplierId={editTarget.supplierId}
              onChange={(id, name) => {
                setEditProductId(id);
                setEditProduct(name);
              }}
            />
          </div>
          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">Khu vực/Công trình</div>
            <MasterPicker
              type="KV"
              value={editRegionId}
              displayName={editRegion}
              onChange={(id, name) => {
                setEditRegionId(id);
                setEditRegion(name);
              }}
            />
          </div>
          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">Ghi chú</div>
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-slate-300 focus:ring-2 focus:ring-sky-400 focus:outline-none"
            />
          </div>
        </ModalShell>
      )}

      {/* ── Modal Giao / Sửa KH / Xem (V21) ── */}
      {deliveryTarget && (
        <DeliveryEditorModal
          mode={deliveryTarget.mode}
          summary={summaryFromDetail(deliveryTarget.detail)}
          initialRows={deliveryRows}
          onClose={() => {
            if (!busy) setDeliveryTarget(null);
          }}
          onSaved={() => load(page)}
        />
      )}
      <ColumnCustomizer
        open={colOpen}
        tabKey="details"
        columns={DETAIL_COLUMNS}
        onClose={() => setColOpen(false)}
        onApply={setColState}
      />
    </div>
  );
}
