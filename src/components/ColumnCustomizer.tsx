"use client";

import React, { useEffect, useState } from "react";
import type { ColumnDef, ColumnState } from "@/lib/column-prefs";
import { defaultState, loadColumnState, saveColumnState } from "@/lib/column-prefs";

type Props = {
  open: boolean;
  tabKey: string;
  columns: ColumnDef[];
  onClose: () => void;
  onApply: (state: ColumnState) => void;
};

export function ColumnCustomizer({
  open,
  tabKey,
  columns,
  onClose,
  onApply,
}: Props) {
  const [order, setOrder] = useState<string[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const st = loadColumnState(tabKey, columns);
    setOrder(st.order);
    setVisible(st.visible);
  }, [open, tabKey, columns]);

  if (!open) return null;

  const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));

  function apply() {
    const state: ColumnState = { order, visible };
    saveColumnState(tabKey, state);
    onApply(state);
    onClose();
  }

  function resetDefault() {
    const st = defaultState(columns);
    setOrder(st.order);
    setVisible(st.visible);
  }

  function selectAll(checked: boolean) {
    const next: Record<string, boolean> = {};
    for (const c of columns) next[c.key] = checked;
    setVisible(next);
  }

  function onDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== dragKey);
      const idx = next.indexOf(targetKey);
      next.splice(idx < 0 ? next.length : idx, 0, dragKey);
      return next;
    });
    setDragKey(null);
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-bold text-slate-800 text-sm">Tùy chỉnh cột</h3>
          <button type="button" className="text-xl text-slate-400" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="px-4 py-2 flex gap-2 border-b bg-slate-50">
          <button
            type="button"
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border bg-white"
            onClick={() => selectAll(true)}
          >
            Chọn tất cả
          </button>
          <button
            type="button"
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border bg-white"
            onClick={() => selectAll(false)}
          >
            Bỏ chọn
          </button>
          <button
            type="button"
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border bg-white ml-auto"
            onClick={resetDefault}
          >
            Mặc định
          </button>
        </div>
        <div className="p-3 overflow-y-auto flex-1 space-y-1.5">
          {order.map((key) => {
            const col = byKey[key];
            if (!col) return null;
            return (
              <div
                key={key}
                draggable
                onDragStart={() => setDragKey(key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(key)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-white cursor-grab active:cursor-grabbing"
              >
                <span className="text-slate-400 text-sm select-none" title="Kéo sắp xếp">
                  ⋮⋮
                </span>
                <input
                  type="checkbox"
                  checked={visible[key] !== false}
                  onChange={(e) =>
                    setVisible((v) => ({ ...v, [key]: e.target.checked }))
                  }
                  className="w-4 h-4 accent-sky-600"
                />
                <label className="text-sm text-slate-800 flex-1">{col.label}</label>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t flex gap-2 justify-end">
          <button
            type="button"
            className="px-3 py-2 text-sm font-semibold rounded-xl bg-slate-200"
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm font-bold rounded-xl bg-sky-500 text-white"
            onClick={apply}
          >
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lọc giá trị cột — multi unique values */
export function ValueFilterBar({
  filters,
  options,
  onChange,
}: {
  filters: Record<string, string[]>;
  options: { key: string; label: string; values: string[] }[];
  onChange: (next: Record<string, string[]>) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-2 items-end">
      {options.map((opt) => (
        <div key={opt.key} className="min-w-[140px]">
          <div className="text-[10px] font-semibold text-slate-500 mb-0.5">
            {opt.label}
          </div>
          <select
            multiple
            size={1}
            value={filters[opt.key] || []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(
                (o) => o.value
              );
              // single-select style: if click one, set that; empty = all
              const v = e.target.value;
              const cur = filters[opt.key] || [];
              let next: string[];
              if (!v) next = [];
              else if (cur.includes(v) && cur.length === 1) next = [];
              else next = [v];
              onChange({ ...filters, [opt.key]: next });
            }}
            className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="">Tất cả</option>
            {opt.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      ))}
      {Object.values(filters).some((a) => a?.length) && (
        <button
          type="button"
          className="text-[11px] font-semibold text-sky-600 px-2 py-1.5"
          onClick={() => onChange({})}
        >
          Xóa lọc
        </button>
      )}
    </div>
  );
}
