"use client";

import React from "react";

/**
 * Ô số chấp nhận dấu phẩy VN (12,5 → 12.5).
 * value: string hiển thị (giữ nguyên khi đang gõ).
 * onValueChange: (display: string, numeric: number | null) => void
 */
export function DecimalInput({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  min,
}: {
  value: string;
  onValueChange: (display: string, numeric: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: number;
}) {
  function handleChange(raw: string) {
    // Cho phép: số, một dấu , hoặc ., xóa
    let s = raw.replace(/[^\d,.\-]/g, "");
    // chỉ một dấu phân cách thập phân
    const comma = s.indexOf(",");
    const dot = s.indexOf(".");
    if (comma >= 0 && dot >= 0) {
      // giữ dấu xuất hiện sau
      if (comma > dot) s = s.replace(/\./g, "");
      else s = s.replace(/,/g, "");
    }
    // không cho nhiều dấu ,
    const parts = s.split(",");
    if (parts.length > 2) s = parts[0] + "," + parts.slice(1).join("");
    const partsD = s.split(".");
    if (partsD.length > 2) s = partsD[0] + "." + partsD.slice(1).join("");

    const normalized = s.replace(",", ".");
    if (normalized === "" || normalized === "-" || normalized === ".") {
      onValueChange(s, null);
      return;
    }
    const n = Number(normalized);
    if (Number.isNaN(n)) {
      onValueChange(s, null);
      return;
    }
    if (min != null && n < min) {
      onValueChange(s, n);
      return;
    }
    onValueChange(s, n);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder}
      value={value}
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
  const n = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
