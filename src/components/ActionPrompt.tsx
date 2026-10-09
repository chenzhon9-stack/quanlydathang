"use client";

import { useEffect, useState } from "react";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "text";
  defaultValue?: string | number;
  hint?: string;
};

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  fields: Field[];
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
};

/**
 * Modal hành động (Nhận hàng, Hủy…).
 * Chỉ đóng khi × / Hủy / click backdrop / Escape — không đóng khi rê chuột ra ngoài panel.
 */
export function ActionPrompt({
  open,
  title,
  subtitle,
  fields,
  confirmLabel = "Xác nhận",
  danger,
  onCancel,
  onConfirm,
}: Props) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      init[f.key] = f.defaultValue != null ? String(f.defaultValue) : "";
    });
    setVals(init);
    setErr("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && !busy) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey || !e.shiftKey) {
          e.preventDefault();
          void submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel, vals]);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onConfirm(vals);
    } catch (e: unknown) {
      setErr((e as Error)?.message || "Lỗi");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bg-[#1a3a5c] text-white px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm sm:text-base leading-snug">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-slate-300 mt-0.5 font-mono">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-slate-300 hover:text-white text-lg leading-none px-1"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3 bg-slate-50">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[12px] font-bold text-slate-700">
                {f.label}
              </span>
              <input
                type={f.type === "number" ? "text" : f.type || "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                value={vals[f.key] ?? ""}
                onChange={(e) =>
                  setVals((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                onFocus={(e) => {
                  if (f.type === "number" || f.type === "text") {
                    e.target.select();
                  }
                }}
              />
              {f.hint && (
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  {f.hint}
                </span>
              )}
            </label>
          ))}
          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
              {err}
            </p>
          )}
        </div>

        <div className="px-4 py-3 bg-white border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className={`px-3 py-1.5 text-sm rounded-lg text-white font-medium ${
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-sky-600 hover:bg-sky-500"
            } disabled:opacity-60`}
          >
            {busy ? "Đang lưu…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export { apiPost, apiPatch } from "@/lib/api-client";
