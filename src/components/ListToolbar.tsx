"use client";

import { statusChipClass } from "@/lib/status-styles";
import { matchSearchVn } from "@/lib/vn-search";

export type StatusOption = { key: string; label: string };

type Props = {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  statuses: StatusOption[];
  selectedStatuses: string[];
  onToggleStatus: (key: string) => void;
  groupByDate: boolean;
  onGroupByDate: (v: boolean) => void;
  countLabel?: string;
  /** Lọc khoảng ngày (yyyy-MM-dd) — tab Chi tiết / Giao hàng */
  fromDate?: string;
  toDate?: string;
  onFromDate?: (v: string) => void;
  onToDate?: (v: string) => void;
  dateLabel?: string;
  /** Phân trang client/server */
  pageSize?: number;
  onPageSize?: (n: number) => void;
  pageSizeOptions?: number[];
};

export function ListToolbar({
  search,
  onSearch,
  searchPlaceholder = "Tìm (Và: khoảng trắng/+ · Hoặc: ;) — mã, tên…",
  statuses,
  selectedStatuses,
  onToggleStatus,
  groupByDate,
  onGroupByDate,
  countLabel,
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  dateLabel = "Theo ngày",
  pageSize,
  onPageSize,
  pageSizeOptions = [50, 100, 200],
}: Props) {
  const allOn =
    selectedStatuses.length === 0 || selectedStatuses.includes("ALL");
  const showDate = typeof onFromDate === "function";
  const showPageSize = typeof onPageSize === "function" && pageSize != null;

  return (
    <div className="space-y-2.5">
      {/* Hàng 1: Nhóm theo ngày + lọc ngày + dòng/trang + đếm */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 px-3 py-2 border border-slate-300 rounded-xl bg-white cursor-pointer select-none shadow-sm">
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => onGroupByDate(e.target.checked)}
            className="accent-sky-600 w-4 h-4"
          />
          Nhóm theo ngày
        </label>

        {showDate && (
          <>
            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                {dateLabel} từ
              </label>
              <input
                type="date"
                value={fromDate || ""}
                onChange={(e) => onFromDate?.(e.target.value)}
                className="px-2.5 py-2 text-sm border border-slate-300 rounded-xl bg-white shadow-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                đến
              </label>
              <input
                type="date"
                value={toDate || ""}
                onChange={(e) => onToDate?.(e.target.value)}
                className="px-2.5 py-2 text-sm border border-slate-300 rounded-xl bg-white shadow-sm"
              />
            </div>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  onFromDate?.("");
                  onToDate?.("");
                }}
                className="px-2.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-600"
              >
                Xóa ngày
              </button>
            )}
          </>
        )}

        {showPageSize && (
          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
              Dòng/trang
            </label>
            <select
              value={pageSize}
              onChange={(e) => onPageSize?.(Number(e.target.value))}
              className="px-2.5 py-2 text-sm border border-slate-300 rounded-xl bg-white shadow-sm"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}

        {countLabel && (
          <span className="text-xs text-slate-500 shrink-0 font-semibold tabular-nums px-1 pb-2">
            {countLabel}
          </span>
        )}
      </div>

      {/* Hàng 2: Ô tìm kiếm đa năng */}
      <div>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full min-w-0 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
      </div>

      {/* Hàng 3: Chip trạng thái */}
      <div className="-mx-1 px-1 flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onToggleStatus("ALL")}
          className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border-2 transition active:scale-95 ${
            allOn
              ? "bg-sky-600 text-white border-sky-700 shadow-md ring-2 ring-offset-1 ring-sky-300"
              : "bg-white text-slate-600 border-slate-300 hover:border-sky-400"
          }`}
        >
          Tất cả
        </button>
        {statuses
          .filter((s) => s.key !== "ALL")
          .map((s) => {
            const on = !allOn && selectedStatuses.includes(s.key);
            const chip = statusChipClass(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onToggleStatus(s.key)}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold border-2 transition active:scale-95 ${chip} ${
                  on
                    ? "shadow-md ring-2 ring-offset-1 ring-slate-400 scale-[1.03] opacity-100"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                {s.label}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function toggleStatus(current: string[], key: string): string[] {
  if (key === "ALL") return ["ALL"];
  const withoutAll = current.filter((k) => k !== "ALL");
  if (withoutAll.includes(key)) {
    const next = withoutAll.filter((k) => k !== key);
    return next.length ? next : ["ALL"];
  }
  return [...withoutAll, key];
}

export function matchStatuses(
  status: string,
  selected: string[]
): boolean {
  if (!selected.length || selected.includes("ALL")) return true;
  return selected.includes(status);
}

export function matchSearch(haystack: string, query: string): boolean {
  return matchSearchVn(haystack, query);
}
