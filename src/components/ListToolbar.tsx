"use client";

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
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
        />
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 px-2 py-2 border border-slate-200 rounded-lg bg-white cursor-pointer select-none">
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => onGroupByDate(e.target.checked)}
          />
          Nhóm theo ngày
        </label>
        {countLabel && (
          <span className="text-xs text-slate-400 shrink-0">{countLabel}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onToggleStatus("ALL")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
            allOn
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          Tất cả
        </button>
        {statuses
          .filter((s) => s.key !== "ALL")
          .map((s) => {
            const on = !allOn && selectedStatuses.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onToggleStatus(s.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  on
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
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
export function toggleStatus(
  current: string[],
  key: string
): string[] {
  if (key === "ALL") return ["ALL"];
  const withoutAll = current.filter((x) => x !== "ALL");
  if (withoutAll.includes(key)) {
    const next = withoutAll.filter((x) => x !== key);
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

export function matchSearch(
  haystack: string,
  q: string
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return haystack.toLowerCase().includes(s);
}
