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
  }, [open, fields]);

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-[#1a3a5c] text-white px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm sm:text-base leading-snug">{title}</h3>
            {subtitle && (
              <p className="text-[11px] text-slate-300 mt-0.5 font-mono">{subtitle}</p>
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

        {/* Body */}
        <div className="p-4 space-y-3 bg-slate-50">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[12px] font-bold text-slate-700">
                {f.label}
              </span>
              <input
                type={f.type || "text"}
                step={f.type === "number" ? "0.01" : undefined}
                value={vals[f.key] ?? ""}
                onChange={(e) =>
                  setVals((v) => ({ ...v, [f.key]: e.target.value }))
                }
                className="mt-1 w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400"
              />
              {f.hint && (
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  {f.hint}
                </span>
              )}
            </label>
          ))}
          {err && (
            <div className="text-xs text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2 font-medium">
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-white border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`px-4 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-50 shadow-sm ${
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-sky-500 hover:bg-sky-400 text-slate-900"
            }`}
          >
            {busy ? "Đang lưu…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export async function apiPost(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } }> {
  const token = localStorage.getItem("token");
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

export async function apiPatch(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } }> {
  const token = localStorage.getItem("token");
  const res = await fetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}
