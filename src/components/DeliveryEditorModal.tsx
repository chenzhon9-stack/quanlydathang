"use client";

import React, { useEffect, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { apiPatch } from "@/components/ActionPrompt";
import type { Delivery, OrderDetail } from "@/types";

export type DeliveryModalMode = "plan" | "real" | "view";

function fmtNum(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("vi-VN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDateVN(ymd?: string) {
  if (!ymd || ymd === "—") return "—";
  const p = ymd.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return ymd;
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-snug pr-2">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1 shrink-0"
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

type Summary = {
  vehiclePlate?: string;
  vehicleId?: string;
  productName?: string;
  productId?: string;
  quantity?: number;
  actualReceived?: number;
  actualDelivered?: number;
  detailId: string;
};

type Props = {
  mode: DeliveryModalMode;
  summary: Summary;
  /** initial rows — if empty, modal will fetch by detailId */
  initialRows?: Delivery[];
  onClose: () => void;
  onSaved?: () => void;
};

export function DeliveryEditorModal({
  mode,
  summary,
  initialRows,
  onClose,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<Delivery[]>(initialRows || []);
  const [loading, setLoading] = useState(!initialRows);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialRows && initialRows.length) {
      setRows(
        mode === "real"
          ? initialRows.map((r) => ({
              ...r,
              actualQty: r.actualQty ?? 0,
              deliveryDate:
                r.deliveryDate || new Date().toISOString().slice(0, 10),
            }))
          : initialRows
      );
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("token");
        const qs = new URLSearchParams({
          detailId: summary.detailId,
          year: String(new Date().getFullYear()),
          pageSize: "100",
        });
        const res = await fetch(`/api/v1/deliveries?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const list: Delivery[] = json.data?.items || json.data || [];
        if (cancelled) return;
        setRows(
          mode === "real"
            ? list.map((r) => ({
                ...r,
                actualQty: r.actualQty ?? 0,
                deliveryDate:
                  r.deliveryDate || new Date().toISOString().slice(0, 10),
              }))
            : list
        );
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary.detailId, mode, initialRows]);

  const sumTg = rows.reduce((s, r) => s + (Number(r.actualQty) || 0), 0);
  const sumKh = rows.reduce((s, r) => s + (Number(r.plannedQty) || 0), 0);

  const title =
    mode === "plan"
      ? `Sửa kế hoạch giao: Xe ${summary.vehiclePlate || summary.vehicleId || "—"} | Hàng: ${summary.productName || summary.productId || "—"}`
      : mode === "real"
        ? `Giao hàng thực tế: Xe ${summary.vehiclePlate || summary.vehicleId || "—"} | Hàng: ${summary.productName || summary.productId || "—"}`
        : `Xem chi tiết giao hàng: Xe ${summary.vehiclePlate || summary.vehicleId || "—"} | Hàng: ${summary.productName || summary.productId || "—"}`;

  async function submitPlan() {
    setBusy(true);
    try {
      const token = localStorage.getItem("token");
      const body = {
        year: new Date().getFullYear(),
        rows: rows.map((r) => ({
          deliveryId: r.deliveryId?.startsWith("NEW-")
            ? undefined
            : r.deliveryId,
          customerId: r.customerId,
          customerDetail: r.customerName || r.customerDetail,
          plannedQty: Number(r.plannedQty) || 0,
          note: r.note,
        })),
      };
      const res = await fetch(
        `/api/v1/order-details/${encodeURIComponent(summary.detailId)}/plan`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Lỗi lưu kế hoạch");
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReal() {
    setBusy(true);
    try {
      for (const r of rows) {
        if (!r.deliveryId || r.deliveryId.startsWith("NEW-")) continue;
        const body: Record<string, unknown> = {
          actualQty: Number(r.actualQty) || 0,
          deliveryDate: r.deliveryDate,
          customerId: r.customerId,
          customerDetail: r.customerName || r.customerDetail || "",
          year: new Date().getFullYear(),
        };
        let json = await apiPatch(
          `/api/v1/deliveries/${encodeURIComponent(r.deliveryId)}`,
          body
        );
        const err = json.error as
          | { code?: string; message?: string }
          | undefined;
        if (!json.success && err?.code === "NEED_CONFIRM") {
          if (!confirm(err.message || "Cần xác nhận")) return;
          body.confirm = true;
          json = await apiPatch(
            `/api/v1/deliveries/${encodeURIComponent(r.deliveryId)}`,
            body
          );
        }
        if (!json.success) {
          throw new Error(err?.message || json.error?.message || "Lỗi lưu giao");
        }
      }
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={title}
      onClose={() => !busy && onClose()}
      footer={
        mode === "view" ? (
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-200 text-slate-700 font-bold text-sm"
          >
            Đóng
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || loading}
            onClick={mode === "real" ? submitReal : submitPlan}
            className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm disabled:opacity-50"
          >
            {busy ? "Đang lưu…" : "LƯU"}
          </button>
        )
      }
    >
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs">
        <div>
          <div className="text-slate-500 font-semibold">Xe</div>
          <div className="font-bold">
            {summary.vehiclePlate || summary.vehicleId || "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-semibold">Hàng hóa</div>
          <div className="font-bold break-words">
            {summary.productName || summary.productId || "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-semibold">KH giao</div>
          <div className="font-bold tabular-nums">
            {fmtNum(summary.quantity ?? sumKh)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-semibold">Thực nhận</div>
          <div className="font-bold tabular-nums">
            {fmtNum(summary.actualReceived ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-semibold">Thực giao</div>
          <div className="font-bold tabular-nums">
            {fmtNum(summary.actualDelivered ?? sumTg)}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-6 text-sm">
          Đang tải dòng giao…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-slate-400 py-6 text-sm">
          Chưa có dòng giao hàng cho chi tiết này
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header desktop */}
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 px-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            <div>Khách hàng</div>
            <div className="text-center">KH giao</div>
            <div className="text-center">Thực giao</div>
            <div className="text-center">Ngày giao</div>
            <div className="w-24 text-right">Mã GH</div>
          </div>

          {rows.map((r, idx) => (
            <div
              key={r.deliveryId || idx}
              className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-start border border-slate-200 rounded-xl p-2.5 bg-white"
            >
              {/* Khách — rộng gấp đôi, xuống dòng */}
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 font-semibold sm:hidden mb-0.5">
                  Khách
                </div>
                {mode === "view" ? (
                  <div className="text-sm font-medium px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 whitespace-normal break-words leading-snug min-h-[40px]">
                    {r.customerName || r.customerDetail || r.customerId || "—"}
                  </div>
                ) : (
                  <div className="min-w-0">
                    <MasterPicker
                      type="KH"
                      value={r.customerId}
                      displayName={
                        r.customerName || r.customerDetail || r.customerId
                      }
                      onChange={(id, name) => {
                        setRows((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  customerId: id,
                                  customerName: name,
                                  customerDetail: name,
                                }
                              : x
                          )
                        );
                      }}
                    />
                  </div>
                )}
              </div>

              {/* KH giao */}
              <div>
                <div className="text-[10px] text-slate-500 font-semibold sm:hidden mb-0.5">
                  KH giao
                </div>
                {mode === "plan" ? (
                  <input
                    type="number"
                    step="0.01"
                    value={r.plannedQty ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, plannedQty: v === "" ? 0 : Number(v) }
                            : x
                        )
                      );
                    }}
                    className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg tabular-nums text-center"
                  />
                ) : (
                  <div className="text-sm tabular-nums px-2 py-2 rounded-lg bg-slate-100 border border-slate-200 text-center">
                    {fmtNum(r.plannedQty)}
                  </div>
                )}
              </div>

              {/* Thực giao */}
              <div>
                <div className="text-[10px] text-slate-500 font-semibold sm:hidden mb-0.5">
                  Thực giao
                </div>
                {mode === "real" ? (
                  <input
                    type="number"
                    step="0.01"
                    value={r.actualQty ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? { ...x, actualQty: v === "" ? 0 : Number(v) }
                            : x
                        )
                      );
                    }}
                    className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg tabular-nums text-center"
                  />
                ) : (
                  <div className="text-sm tabular-nums px-2 py-2 rounded-lg bg-slate-100 border border-slate-200 text-center">
                    {fmtNum(r.actualQty ?? 0)}
                  </div>
                )}
              </div>

              {/* Ngày */}
              <div>
                <div className="text-[10px] text-slate-500 font-semibold sm:hidden mb-0.5">
                  Ngày giao
                </div>
                {mode === "real" ? (
                  <input
                    type="date"
                    value={r.deliveryDate || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, deliveryDate: v } : x
                        )
                      );
                    }}
                    className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                ) : (
                  <div className="text-sm px-2 py-2 rounded-lg bg-slate-100 border border-slate-200 text-center">
                    {r.deliveryDate ? fmtDateVN(r.deliveryDate) : "—"}
                  </div>
                )}
              </div>

              {/* Mã GH + xóa */}
              <div className="flex items-center gap-1 justify-end min-w-[5.5rem]">
                <div className="text-[10px] text-slate-400 font-mono truncate max-w-[72px]">
                  {r.deliveryId?.startsWith("NEW-") ? "mới" : r.deliveryId}
                </div>
                {mode === "plan" && (
                  <button
                    type="button"
                    title="Xóa dòng"
                    onClick={() =>
                      setRows((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="w-7 h-7 shrink-0 rounded-lg bg-red-500 text-white text-sm font-bold"
                  >
                    −
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === "plan" && (
        <button
          type="button"
          onClick={() => {
            setRows((prev) => [
              ...prev,
              {
                deliveryId: `NEW-${Date.now()}`,
                detailId: summary.detailId,
                customerId: "",
                customerName: "",
                plannedQty: 0,
                actualQty: 0,
              } as Delivery,
            ]);
          }}
          className="text-sm font-semibold text-sky-600 hover:underline"
        >
          + Thêm khách kế hoạch
        </button>
      )}
    </ModalShell>
  );
}

/** Helper: summary từ OrderDetail */
export function summaryFromDetail(d: OrderDetail): Summary {
  return {
    detailId: d.detailId,
    vehiclePlate: d.vehiclePlate,
    vehicleId: d.vehicleId,
    productName: d.productName,
    productId: d.productId,
    quantity: d.quantity,
    actualReceived: d.actualReceived,
    actualDelivered: d.actualDelivered,
  };
}

/** Helper: summary từ Delivery (tab giao) */
export function summaryFromDelivery(d: Delivery): Summary {
  return {
    detailId: d.detailId,
    vehiclePlate: d.vehiclePlate,
    vehicleId: d.vehicleId,
    productName: d.productName,
    productId: d.productId,
    // quantity/received không có trên GH — modal sẽ hiện sum từ rows
  };
}
