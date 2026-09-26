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
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-0 px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl bg-white shadow-sm focus:ring-2 focus:ring-sky-400 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 px-3 py-2.5 border border-slate-300 rounded-xl bg-white cursor-pointer select-none shadow-sm flex-1 sm:flex-none">
            <input
              type="checkbox"
              checked={groupByDate}
              onChange={(e) => onGroupByDate(e.target.checked)}
              className="accent-sky-600 w-4 h-4"
            />
            Nhóm theo ngày
          </label>
          {countLabel && (
            <span className="text-xs text-slate-500 shrink-0 font-semibold tabular-nums px-1">
              {countLabel}
            </span>
          )}
        </div>
      </div>
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
