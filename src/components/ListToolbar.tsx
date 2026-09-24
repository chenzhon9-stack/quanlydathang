"use client";

import { STATUS_CHIP } from "@/lib/status-styles";
import { matchSearchVn } from "@/lib/vn-search";

export type StatusOption = { key: string; label: string };

type Props = {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  statuses: StatusOption[];
  selectedStatuses: string[]; // empty or includes ALL → all
  onToggleStatus: (key: string) => void;
  groupByDate: boolean;
  onGroupByDate: (v: boolean) => void;
  countLabel?: string;
};

export function ListToolbar({
  search,
  onSearch,
  searchPlaceholder = "Tìm mã, tên, NCC, KH…",
  statuses,
  selectedStatuses,
  onToggleStatus,
  groupByDate,
  onGroupByDate,
  countLabel,
}: Props) {
  const allOn =
    selectedStatuses.length === 0 || selectedStatuses.includes("ALL");

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white shadow-sm"
        />
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 px-3 py-2 border border-slate-300 rounded-lg bg-white cursor-pointer select-none shadow-sm">
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => onGroupByDate(e.target.checked)}
            className="accent-sky-600"
          />
          Nhóm theo ngày
        </label>
        {countLabel && (
          <span className="text-xs text-slate-500 shrink-0 font-medium">
            {countLabel}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onToggleStatus("ALL")}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition ${
            allOn
              ? "bg-sky-500 text-white border-sky-600 shadow-sm"
              : "bg-white text-slate-500 border-slate-200 opacity-50 grayscale hover:opacity-80"
          }`}
        >
          Tất cả
        </button>
        {statuses
          .filter((s) => s.key !== "ALL")
          .map((s) => {
            const on = !allOn && selectedStatuses.includes(s.key);
            const chip = STATUS_CHIP[s.key] || "bg-slate-100 text-slate-700 border-slate-300";
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onToggleStatus(s.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition ${
                  on
                    ? `${chip} shadow-sm scale-[1.03]`
                    : `${chip} opacity-40 grayscale hover:opacity-70`
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

/** Multi-select status helper */
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
  // Không dấu tiếng Việt + AND theo khoảng trắng / ; / +
  return matchSearchVn(haystack, query);
}
