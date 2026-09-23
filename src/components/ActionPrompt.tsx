"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  title: string;
  fields: Array<{
    key: string;
    label: string;
    type?: "number" | "date" | "text";
    defaultValue?: string | number;
  }>;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
};

export function ActionPrompt({
  open,
  title,
  fields,
  confirmLabel = "Xác nhận",
  onCancel,
  onConfirm,
}: Props) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      init[f.key] = f.defaultValue != null ? String(f.defaultValue) : "";
    });
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-4 space-y-3">
        <h3 className="font-bold text-slate-800">{title}</h3>
        {fields.map((f) => (
          <label key={f.key} className="block text-xs text-slate-600">
            {f.label}
            <input
              type={f.type || "text"}
              step={f.type === "number" ? "0.01" : undefined}
              value={vals[f.key] ?? ""}
              onChange={(e) =>
                setVals((v) => ({ ...v, [f.key]: e.target.value }))
              }
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </label>
        ))}
        {err && (
          <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
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
