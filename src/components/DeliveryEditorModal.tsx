"use client";

import React, { useEffect, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { DecimalInput, parseDecimalVN, formatDecimalVN } from "@/components/DecimalInput";
import {
  deliveryDateBounds,
  clampYmd,
  stepErrorMsg,
  parseTyleChiahet,
} from "@/lib/business-rules";
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

/** CT-YYMMDD-#### → năm (CT-261009-0020 → 2026) */
function yearFromDetailId(detailId?: string): number {
  const m = String(detailId || "").trim().match(/^CT-(\d{2})\d{4}-/i);
  if (m) {
    const yy = Number(m[1]);
    if (Number.isFinite(yy)) return yy >= 70 ? 1900 + yy : 2000 + yy;
  }
  return new Date().getFullYear();
}

function resolvePayloadYear(summary: { detailId?: string; orderDate?: string; year?: number }): number {
  if (summary.year && Number.isFinite(summary.year)) return Number(summary.year);
  if (summary.orderDate && /^\d{4}/.test(summary.orderDate)) {
    return Number(summary.orderDate.slice(0, 4));
  }
  return yearFromDetailId(summary.detailId);
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
  onSubmit,
  submitDisabled,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onSubmit?: () => void;
  submitDisabled?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (submitDisabled || !onSubmit) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      // Lưu: Shift+S hoặc Ctrl/Cmd+Enter — KHÔNG Enter thường (tránh lưu khi đang nhập)
      const isShiftS =
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === "S" || e.key === "s");
      const isCtrlEnter = e.key === "Enter" && (e.ctrlKey || e.metaKey);
      if (isShiftS || isCtrlEnter) {
        e.preventDefault();
        onSubmit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSubmit, submitDisabled]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
      >
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
  receivedDate?: string;
  isDuyenHa?: boolean;
  /** TyleChiahet — nếu thiếu sẽ tự load từ masters */
  tyleChiahet?: number;
  orderDate?: string;
  year?: number;
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
  /** Chuỗi đang gõ (giữ dấu phẩy). Key: p-{idx} KH giao, a-{idx} Thực giao */
  const [qtyDisp, setQtyDisp] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!initialRows);
  const [busy, setBusy] = useState(false);
  const [tyleChiahet, setTyleChiahet] = useState(Number(summary.tyleChiahet) || 0);

  // Load TyleChiahet từ master HH nếu chưa có (API: type=HH → data.items)
  useEffect(() => {
    if (Number(summary.tyleChiahet) > 0) {
      setTyleChiahet(Number(summary.tyleChiahet));
      return;
    }
    const pid = String(summary.productId || "").trim();
    if (!pid) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/v1/masters?type=HH", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const list: Record<string, string>[] =
          json.data?.items || json.data?.HH || json.data?.hh || [];
        const row = list.find(
          (r) =>
            String(r.MaHH || r.MaHh || "").trim().toUpperCase() ===
            pid.toUpperCase()
        );
        if (!cancelled && row) setTyleChiahet(parseTyleChiahet(row));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary.productId, summary.tyleChiahet]);

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
          year: String(resolvePayloadYear(summary)),
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
            ? list.map((r) => {
                const bounds = deliveryDateBounds({
                  receivedDate: summary.receivedDate,
                  isDuyenHa: !!summary.isDuyenHa,
                });
                const raw =
                  r.deliveryDate || bounds.max || "";
                return {
                  ...r,
                  actualQty: r.actualQty ?? 0,
                  deliveryDate: clampYmd(raw, bounds.min, bounds.max),
                };
              })
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
    for (const r of rows) {
      const qty = Number(r.plannedQty) || 0;
      if (!(qty > 0)) {
        alert("KH giao phải > 0");
        return;
      }
      const msg = stepErrorMsg(
        summary.productName || summary.productId || "",
        qty,
        tyleChiahet
      );
      if (msg) {
        alert(msg);
        return;
      }
    }
    setBusy(true);
    try {
      const token = localStorage.getItem("token");
      const body = {
        year: resolvePayloadYear(summary),
        rows: rows.map((r) => ({
          deliveryId: r.deliveryId?.startsWith("NEW-")
            ? undefined
            : r.deliveryId,
          customerId: r.customerId,
          customerDetail: r.customerDetail || "", // không ghi TenKH vào ChitietKh
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
    // Validate chia hết client-side trước
    for (const r of rows) {
      const qty = Number(r.actualQty) || 0;
      if (qty > 0) {
        const msg = stepErrorMsg(
          summary.productName || summary.productId || "",
          qty,
          tyleChiahet
        );
        if (msg) {
          alert(msg);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const token = localStorage.getItem("token");
      const body: Record<string, unknown> = {
        year: resolvePayloadYear(summary),
        rows: rows.map((r) => ({
          deliveryId: r.deliveryId?.startsWith("NEW-")
            ? undefined
            : r.deliveryId,
          customerId: r.customerId,
          customerDetail: r.customerDetail || "",
          plannedQty: Number(r.plannedQty) || 0,
          actualQty: Number(r.actualQty) || 0,
          deliveryDate: r.deliveryDate || new Date().toISOString().slice(0, 10),
          note: r.note,
        })),
      };
      const call = async (payload: Record<string, unknown>) => {
        const res = await fetch(
          `/api/v1/order-details/${encodeURIComponent(summary.detailId)}/real`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          }
        );
        return res.json();
      };
      let json = await call(body);
      const err = json.error as
        | { code?: string; message?: string }
        | undefined;
      // V21: TG < TN / vượt ngưỡng → hỏi xác nhận
      if (!json.success && err?.code === "NEED_CONFIRM") {
        if (!confirm(err.message || "Cần xác nhận")) return;
        body.confirmFinish = true;
        body.confirm = true;
        json = await call(body);
      }
      if (!json.success) {
        throw new Error(err?.message || json.error?.message || "Lỗi lưu giao");
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
      onSubmit={
        mode === "view" || busy || loading
          ? undefined
          : () => {
              if (mode === "real") void submitReal();
              else void submitPlan();
            }
      }
      submitDisabled={mode === "view" || busy || loading}
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
            title="Shift+S hoặc Ctrl+Enter"
          >
            {busy ? "Đang lưu…" : "LƯU"}
            {!busy && !loading && (
              <span className="ml-2 text-[11px] font-semibold opacity-80">⇧S</span>
            )}
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
              data-delivery-row={idx}
              className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-start border border-slate-200 rounded-xl p-2.5 bg-white"
            >
              {/* Khách — rộng gấp đôi, xuống dòng */}
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 font-semibold sm:hidden mb-0.5">
                  Khách
                </div>
                {mode === "view" ? (
                  <div className="text-sm font-medium px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 whitespace-normal break-words leading-snug min-h-[40px]">
                    {r.customerName || r.customerId || "—"}
                  </div>
                ) : (
                  <div className="min-w-0">
                    <MasterPicker
                      type="KH"
                      value={r.customerId}
                      displayName={
                        r.customerName || r.customerId
                      }
                      autoFocus={mode === "real" && idx === 0}
                      onChange={(id, name) => {
                        setRows((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  customerId: id,
                                  customerName: name,
                                  // ChitietKh không lưu tên KH
                                }
                              : x
                          )
                        );
                        // P1: sau chọn KH → focus ô số (thực giao / KH giao)
                        requestAnimationFrame(() => {
                          const sel =
                            mode === "real"
                              ? `input[data-row="${idx}"][data-field="actualQty"]`
                              : `input[data-row="${idx}"][data-field="plannedQty"]`;
                          const qty =
                            document.querySelector<HTMLInputElement>(sel);
                          if (qty) {
                            qty.focus();
                            try {
                              qty.select();
                            } catch {
                              /* ignore */
                            }
                          }
                        });
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
                  (() => {
                    const pq = Number(r.plannedQty) || 0;
                    const pErr =
                      pq > 0
                        ? stepErrorMsg(
                            summary.productName || summary.productId || "",
                            pq,
                            tyleChiahet
                          )
                        : null;
                    return (
                      <>
                        <DecimalInput
                          data-row={idx}
                          data-field="plannedQty"
                          value={
                            qtyDisp[`p-${idx}`] ??
                            formatDecimalVN(r.plannedQty)
                          }
                          className={
                            pErr
                              ? "border-red-400 bg-red-50 focus:ring-red-300"
                              : undefined
                          }
                          onKeyDown={(e) => {
                            // Enter → dòng KH tiếp (plan); không lưu
                            if (e.key !== "Enter" || e.ctrlKey || e.metaKey)
                              return;
                            e.preventDefault();
                            const nextKh = document.querySelector<HTMLElement>(
                              `[data-delivery-row="${idx + 1}"] [data-master-picker-trigger]`
                            );
                            if (nextKh) nextKh.focus();
                          }}
                          onValueChange={(display, num) => {
                            setQtyDisp((d) => ({
                              ...d,
                              [`p-${idx}`]: display,
                            }));
                            if (num != null) {
                              setRows((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, plannedQty: num } : x
                                )
                              );
                            }
                          }}
                        />
                        {pErr && (
                          <p className="text-[10px] text-red-600 font-medium mt-0.5 leading-snug">
                            {pErr}
                          </p>
                        )}
                      </>
                    );
                  })()
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
                  (() => {
                    const aq = Number(r.actualQty) || 0;
                    const aErr =
                      aq > 0
                        ? stepErrorMsg(
                            summary.productName || summary.productId || "",
                            aq,
                            tyleChiahet
                          )
                        : null;
                    return (
                      <>
                        <DecimalInput
                          data-row={idx}
                          data-field="actualQty"
                          value={
                            qtyDisp[`a-${idx}`] ??
                            formatDecimalVN(r.actualQty)
                          }
                          className={
                            aErr
                              ? "border-red-400 bg-red-50 focus:ring-red-300"
                              : undefined
                          }
                          onKeyDown={(e) => {
                            // Enter → ngày giao (không lưu); Shift+S / Ctrl+Enter do ModalShell
                            if (e.key !== "Enter" || e.ctrlKey || e.metaKey)
                              return;
                            e.preventDefault();
                            const next =
                              document.querySelector<HTMLInputElement>(
                                `input[data-delivery-date="${idx}"]`
                              );
                            if (next) {
                              next.focus();
                              try {
                                next.showPicker?.();
                              } catch {
                                /* ignore */
                              }
                            }
                          }}
                          onValueChange={(display, num) => {
                            setQtyDisp((d) => ({
                              ...d,
                              [`a-${idx}`]: display,
                            }));
                            if (num != null) {
                              setRows((prev) =>
                                prev.map((x, i) =>
                                  i === idx ? { ...x, actualQty: num } : x
                                )
                              );
                            }
                          }}
                        />
                        {aErr && (
                          <p className="text-[10px] text-red-600 font-medium mt-0.5 leading-snug">
                            {aErr}
                          </p>
                        )}
                      </>
                    );
                  })()
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
                  (() => {
                    const bounds = deliveryDateBounds({
                      receivedDate: summary.receivedDate,
                      isDuyenHa: !!summary.isDuyenHa,
                    });
                    return (
                      <>
                        <input
                          type="date"
                          data-delivery-date={idx}
                          value={r.deliveryDate || ""}
                          min={bounds.min || undefined}
                          max={bounds.max}
                          onKeyDown={(e) => {
                            // Enter trên ngày → KH dòng tiếp (không lưu)
                            if (e.key !== "Enter" || e.ctrlKey || e.metaKey)
                              return;
                            e.preventDefault();
                            const nextKh =
                              document.querySelector<HTMLElement>(
                                `[data-delivery-row="${idx + 1}"] [data-master-picker-trigger]`
                              );
                            if (nextKh) nextKh.focus();
                          }}
                          onChange={(e) => {
                            const v = clampYmd(
                              e.target.value,
                              bounds.min,
                              bounds.max
                            );
                            setRows((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, deliveryDate: v } : x
                              )
                            );
                          }}
                          className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {bounds.min
                            ? `Từ ${bounds.min} đến ${bounds.max}`
                            : `Đến ${bounds.max} (cần ngày nhận để khóa min)`}
                          {" · Enter → dòng sau · ⇧S lưu"}
                        </div>
                      </>
                    );
                  })()
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

      <div className="flex flex-wrap items-center gap-3">
        {mode === "plan" && (
          <button
            type="button"
            onClick={() => {
              setRows((prev) => {
                const last = prev[prev.length - 1];
                return [
                  ...prev,
                  {
                    deliveryId: `NEW-${Date.now()}`,
                    detailId: summary.detailId,
                    // Mặc định MaKh dòng trước
                    customerId: last?.customerId || "",
                    customerName: last?.customerName || "",
                    plannedQty: 0,
                    actualQty: 0,
                  } as Delivery,
                ];
              });
            }}
            className="text-sm font-semibold text-sky-600 hover:underline"
          >
            + Thêm khách kế hoạch
          </button>
        )}
        {mode === "real" && rows.length > 0 && (
          <button
            type="button"
            title="Gán Thực giao = KH giao cho mọi dòng (chỉ UI, chưa lưu)"
            onClick={() => {
              setRows((prev) => {
                const updated = prev.map((x) => {
                  const pq = Number(x.plannedQty) || 0;
                  return { ...x, actualQty: pq };
                });
                setQtyDisp((d) => {
                  const next = { ...d };
                  updated.forEach((x, i) => {
                    next[`a-${i}`] = formatDecimalVN(
                      Number(x.plannedQty) || 0
                    );
                  });
                  return next;
                });
                return updated;
              });
            }}
            className="text-sm font-semibold text-emerald-700 hover:underline"
          >
            Gán SL = KH giao
          </button>
        )}
      </div>
    </ModalShell>
  );
}

/** Helper: summary từ OrderDetail */
export function summaryFromDetail(d: OrderDetail): Summary {
  const orderDate = d.orderDate || "";
  const year = orderDate && /^\d{4}/.test(orderDate)
    ? Number(orderDate.slice(0, 4))
    : yearFromDetailId(d.detailId);
  return {
    detailId: d.detailId,
    vehiclePlate: d.vehiclePlate,
    vehicleId: d.vehicleId,
    productName: d.productName,
    productId: d.productId,
    quantity: d.quantity,
    actualReceived: d.actualReceived,
    actualDelivered: d.actualDelivered,
    receivedDate: d.receivedDate,
    isDuyenHa: !!d.isDuyenHa,
    tyleChiahet: Number(d.tyleChiahet) || 0,
    orderDate,
    year,
  };
}

/** Helper: summary từ Delivery (tab giao) */
export function summaryFromDelivery(d: Delivery): Summary {
  const any = d as Delivery & {
    receivedDate?: string;
    isDuyenHa?: boolean;
    orderDate?: string;
    actualReceived?: number;
    quantity?: number;
  };
  const orderDate = any.orderDate || d.orderDate || "";
  const year = orderDate && /^\d{4}/.test(orderDate)
    ? Number(orderDate.slice(0, 4))
    : yearFromDetailId(d.detailId);
  return {
    detailId: d.detailId,
    vehiclePlate: d.vehiclePlate,
    vehicleId: d.vehicleId,
    productName: d.productName,
    productId: d.productId,
    quantity: any.quantity,
    actualReceived: any.actualReceived,
    receivedDate: any.receivedDate,
    isDuyenHa: !!any.isDuyenHa,
    orderDate,
    year,
  };
}
