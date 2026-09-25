"use client";

import React, { useEffect, useState } from "react";

/**
 * Ô số thập phân VN — cho phép gõ dấu phẩy (12,5).
 * - Khi focus: giữ nguyên chuỗi đang gõ (kể cả "12," / "12.")
 * - Khi blur: đồng bộ lại từ value bên ngoài
 * value: chuỗi hiển thị từ parent (vd "12,5") hoặc sẽ được derive
 */
export function DecimalInput({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  min,
}: {
  /** Chuỗi hiển thị (khuyến nghị parent giữ string có dấu phẩy) */
  value: string;
  onValueChange: (display: string, numeric: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  // Đồng bộ từ parent khi không focus
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  function sanitize(raw: string): string {
    let s = raw.replace(/[^\d,.\-]/g, "");
    // chỉ một dấu âm ở đầu
    s = s.replace(/(?!^)-/g, "");
    const comma = s.indexOf(",");
    const dot = s.indexOf(".");
    if (comma >= 0 && dot >= 0) {
      // giữ dấu xuất hiện sau cùng làm thập phân
      if (comma > dot) s = s.replace(/\./g, "");
      else s = s.replace(/,/g, "");
    }
    const sep = s.includes(",") ? "," : s.includes(".") ? "." : "";
    if (sep) {
      const i = s.indexOf(sep);
      const head = s.slice(0, i + 1);
      const tail = s.slice(i + 1).replace(/[.,]/g, "");
      s = head + tail;
    }
    return s;
  }

  function toNumber(s: string): number | null {
    if (s === "" || s === "-" || s === "," || s === "." || s === "-," || s === "-.")
      return null;
    const normalized = s.replace(",", ".");
    // cho phép "12." khi đang gõ
    if (normalized.endsWith(".")) {
      const n = Number(normalized.slice(0, -1));
      return Number.isNaN(n) ? null : n;
    }
    const n = Number(normalized);
    return Number.isNaN(n) ? null : n;
  }

  function handleChange(raw: string) {
    const s = sanitize(raw);
    setDraft(s);
    const n = toNumber(s);
    if (n != null && min != null && n < min) {
      onValueChange(s, n);
      return;
    }
    onValueChange(s, n);
  }

  function handleBlur() {
    setFocused(false);
    // Chuẩn hóa hiển thị: 12, → 12 ; giữ phần thập phân có nghĩa
    const n = toNumber(draft);
    if (n == null) {
      setDraft(draft);
      onValueChange(draft, null);
      return;
    }
    // Giữ dấu phẩy VN khi có phần thập phân
    const disp = String(n).replace(".", ",");
    setDraft(disp);
    onValueChange(disp, n);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder ?? "0"}
      value={focused ? draft : value}
      onFocus={() => {
        setFocused(true);
        setDraft(value);
      }}
      onBlur={handleBlur}
      onChange={(e) => handleChange(e.target.value)}
      className={
        className ||
        "w-full px-2 py-2 text-sm border border-slate-300 rounded-lg tabular-nums text-center"
      }
    />
  );
}

/** Parse string có phẩy → number */
export function parseDecimalVN(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  if (s == null || s === "") return 0;
  const n = Number(String(s).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** number → chuỗi hiển thị VN (dấu phẩy) */
export function formatDecimalVN(
  n: number | null | undefined,
  maxFrac = 6
): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  const s = Number(n).toFixed(maxFrac).replace(/\.?0+$/, "");
  return s.replace(".", ",");
}
