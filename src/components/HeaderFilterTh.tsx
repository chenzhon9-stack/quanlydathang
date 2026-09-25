"use client";

/**
 * Header cột + lọc popup (V21) + click tiêu đề để sort.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

export type SortDir = "asc" | "desc" | null;

export function HeaderFilterTh({
  label,
  align = "left",
  filterable,
  values,
  selected,
  onChange,
  sortable,
  sortDir,
  onSort,
  children,
}: {
  label: string;
  align?: "left" | "right";
  filterable?: boolean;
  values?: string[];
  selected?: string[];
  onChange?: (next: string[]) => void;
  sortable?: boolean;
  sortDir?: SortDir;
  onSort?: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTableCellElement>(null);
  const active = (selected?.length || 0) > 0;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const list = values || [];
    if (!q.trim()) return list;
    const n = q.trim().toLowerCase();
    return list.filter((v) => v.toLowerCase().includes(n));
  }, [values, q]);

  function toggle(v: string) {
    if (!onChange) return;
    const cur = selected || [];
    if (cur.includes(v)) onChange(cur.filter((x) => x !== v));
    else onChange([...cur, v]);
  }

  function selectAll(checked: boolean) {
    if (!onChange) return;
    onChange(checked ? [...(values || [])] : []);
  }

  const sortIcon =
    sortDir === "asc" ? " ▲" : sortDir === "desc" ? " ▼" : sortable ? " ↕" : "";

  return (
    <th
      ref={ref}
      className={`relative px-2 py-2 font-bold text-xs whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <div
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        <button
          type="button"
          className={`inline-flex items-center gap-0.5 ${
            sortable ? "cursor-pointer hover:text-sky-700" : "cursor-default"
          }`}
          onClick={() => {
            if (sortable && onSort) onSort();
          }}
          title={sortable ? "Sắp xếp cột" : undefined}
        >
          <span>{label}</span>
          {sortable && (
            <span
              className={`text-[10px] ${
                sortDir ? "text-sky-600" : "text-slate-400"
              }`}
            >
              {sortIcon}
            </span>
          )}
        </button>
        {filterable && (
          <button
            type="button"
            title="Lọc cột"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className={`p-0.5 rounded ${
              active
                ? "text-sky-600 bg-sky-50"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
            </svg>
          </button>
        )}
        {children}
      </div>

      {open && filterable && (
        <div
          className="absolute left-0 top-full mt-1 z-[50] w-56 bg-white border border-slate-200 rounded-xl shadow-xl text-left font-normal normal-case"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b bg-slate-50 text-[12px] font-semibold text-slate-700">
            Lọc: {label}
            {active && (
              <span className="ml-1 text-sky-600">({selected!.length})</span>
            )}
          </div>
          <div className="px-2 py-1.5 border-b">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm…"
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            <label className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  !!values?.length &&
                  (selected?.length || 0) === (values?.length || 0)
                }
                onChange={(e) => selectAll(e.target.checked)}
              />
              <span className="font-medium">Tất cả</span>
            </label>
            {filtered.map((v) => (
              <label
                key={v}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={(selected || []).includes(v)}
                  onChange={() => toggle(v)}
                />
                <span className="truncate" title={v}>
                  {v || "(trống)"}
                </span>
              </label>
            ))}
            {!filtered.length && (
              <div className="px-3 py-2 text-[11px] text-slate-400">
                Không có giá trị
              </div>
            )}
          </div>
          <div className="px-2 py-2 border-t flex gap-2">
            <button
              type="button"
              className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg border"
              onClick={() => {
                onChange?.([]);
                setOpen(false);
              }}
            >
              Xóa lọc
            </button>
            <button
              type="button"
              className="flex-1 text-[11px] font-semibold py-1.5 rounded-lg bg-sky-500 text-white"
              onClick={() => setOpen(false)}
            >
              Xong
            </button>
          </div>
        </div>
      )}
    </th>
  );
}

/** Sort helper dùng chung */
export function cycleSort(
  key: string,
  currentKey: string | null,
  currentDir: SortDir
): { key: string | null; dir: SortDir } {
  if (currentKey !== key) return { key, dir: "asc" };
  if (currentDir === "asc") return { key, dir: "desc" };
  return { key: null, dir: null };
}

export function compareValues(a: unknown, b: unknown, dir: "asc" | "desc") {
  const na = Number(a);
  const nb = Number(b);
  let cmp = 0;
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
    cmp = na - nb;
  } else {
    cmp = String(a ?? "").localeCompare(String(b ?? ""), "vi", {
      numeric: true,
      sensitivity: "base",
    });
  }
  return dir === "asc" ? cmp : -cmp;
}
