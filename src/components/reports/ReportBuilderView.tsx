"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReportSubNav } from "@/components/ReportSubNav";
import { REPORT_SCHEMAS, type ReportType } from "@/lib/reports/dynamic-group";
import { REPORT_COLUMN_META } from "@/lib/column-definitions";
import { ColumnCustomizer } from "@/components/ColumnCustomizer";
import {
  HeaderFilterTh,
  cycleSort,
  compareValues,
  type SortDir,
} from "@/components/HeaderFilterTh";
import {
  type ColumnDef,
  type ColumnState,
  loadColumnState,
  resolveColumns,
} from "@/lib/column-prefs";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  // default: đầu tháng → hôm nay
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

function fmtNum(n: unknown, digits = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function ReportBuilderView({
  type,
  title,
}: {
  type: ReportType;
  title: string;
}) {
  const schema = REPORT_SCHEMAS[type];
  const range0 = useMemo(() => defaultRange(), []);
  const [fromDate, setFromDate] = useState(range0.from);
  const [toDate, setToDate] = useState(range0.to);
  const [groupBy, setGroupBy] = useState<string[]>([...schema.defaultGroupBy]);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<{ total?: number; rawCount?: number }>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [colOpen, setColOpen] = useState(false);
  const [colState, setColState] = useState<ColumnState | null>(null);
  const [valFilters, setValFilters] = useState<Record<string, string[]>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const load = useCallback(
    async (p = 1) => {
      const token = localStorage.getItem("token");
      if (!token) return;
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams({
          type,
          fromDate,
          toDate,
          groupBy: groupBy.join(","),
          page: String(p),
          pageSize: "100",
        });
        const res = await fetch(`/api/v1/reports/builder?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json.success) {
          setErr(json.error?.message || "Lỗi tải báo cáo");
          setItems([]);
          return;
        }
        setItems(json.data.items || []);
        setTotals(json.data.totals || {});
        setMeta(json.meta || json.data.meta || {});
        setPage(p);
      } catch {
        setErr("Không kết nối API");
      } finally {
        setLoading(false);
      }
    },
    [type, fromDate, toDate, groupBy]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  function toggleDim(key: string) {
    setGroupBy((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev; // giữ ít nhất 1
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }

  const metaCols = REPORT_COLUMN_META[type] || [];
  const allCols: ColumnDef[] = [
    ...groupBy.map((k) => {
      const d = schema.dimensions.find((x) => x.key === k);
      const meta = metaCols.find((m) => m.key === k);
      return {
        key: k,
        label: d?.header || meta?.header || k,
        defaultVisible: true,
        filterable: true,
        dimension: true,
      };
    }),
    ...schema.measures.map((m) => {
      const meta = metaCols.find((x) => x.key === m.key);
      return {
        key: m.key,
        label: m.header,
        defaultVisible: true,
        align: (meta?.align as "left" | "right") || "right",
      };
    }),
  ];

  const tabKey = `report:${type}`;
  const effectiveColState: ColumnState =
    colState || loadColumnState(tabKey, allCols);
  const visibleColDefs = resolveColumns(allCols, effectiveColState);

  const displayCols: {
    key: string;
    header: string;
    isMeasure: boolean;
    format?: "int" | "num" | string;
  }[] = visibleColDefs.map((c) => {
    const m = schema.measures.find((x) => x.key === c.key);
    if (m) {
      return {
        key: c.key,
        header: c.label,
        isMeasure: true as const,
        format: m.format as "int" | "num" | string | undefined,
      };
    }
    return { key: c.key, header: c.label, isMeasure: false as const };
  });

  const filteredItems = useMemo(() => {
    let rows = items.filter((row) => {
      for (const [k, vals] of Object.entries(valFilters)) {
        if (!vals?.length) continue;
        const cell = String(row[k] ?? "");
        if (!vals.includes(cell)) return false;
      }
      return true;
    });
    if (sortKey && sortDir) {
      rows = [...rows].sort((a, b) =>
        compareValues(a[sortKey], b[sortKey], sortDir)
      );
    }
    return rows;
  }, [items, valFilters, sortKey, sortDir]);

  const colUnique = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const k of groupBy) {
      map[k] = [
        ...new Set(items.map((r) => String(r[k] ?? "")).filter(Boolean)),
      ].sort();
    }
    return map;
  }, [items, groupBy]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Báo cáo</h2>
          <p className="text-xs text-slate-500">
            {title} · {meta.total ?? 0} nhóm
            {meta.rawCount != null ? ` · ${meta.rawCount} dòng gốc` : ""}
          </p>
        </div>
      </div>

      <ReportSubNav />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 md:p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">
              Từ ngày
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 block mb-1">
              Đến ngày
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5"
            />
          </div>
          <button
            type="button"
            onClick={() => load(1)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white"
          >
            Chấp nhận
          </button>
          <button
            type="button"
            onClick={() => setColOpen(true)}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tùy chỉnh cột
          </button>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
            Nhóm theo (Group by) — giống V21
          </div>
          <div className="flex flex-wrap gap-2">
            {schema.dimensions.map((d) => {
              const on = groupBy.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDim(d.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                    on
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-slate-600 border-slate-200"
                  }`}
                >
                  {d.header}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-600 text-xs">
                  {displayCols.map((c) => (
                    <HeaderFilterTh
                      key={c.key}
                      label={c.header}
                      align={c.isMeasure ? "right" : "left"}
                      filterable={!c.isMeasure}
                      values={colUnique[c.key] || []}
                      selected={valFilters[c.key] || []}
                      onChange={(next) =>
                        setValFilters((f) => ({ ...f, [c.key]: next }))
                      }
                      sortable
                      sortDir={sortKey === c.key ? sortDir : null}
                      onSort={() => {
                        const n = cycleSort(c.key, sortKey, sortDir);
                        setSortKey(n.key);
                        setSortDir(n.dir);
                      }}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((row, i) => (
                  <tr
                    key={i}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    {displayCols.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 whitespace-nowrap ${
                          c.isMeasure
                            ? "text-right tabular-nums font-medium"
                            : "text-slate-700"
                        }`}
                      >
                        {c.isMeasure
                          ? fmtNum(row[c.key], c.format === "int" ? 0 : 2)
                          : String(row[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {!filteredItems.length && (
                  <tr>
                    <td
                      colSpan={displayCols.length}
                      className="text-center py-10 text-slate-400"
                    >
                      Không có dữ liệu
                    </td>
                  </tr>
                )}
              </tbody>
              {filteredItems.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-sm">
                    {displayCols.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 ${
                          c.isMeasure ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {i === 0
                          ? "Tổng"
                          : c.isMeasure
                            ? fmtNum(totals[c.key], c.format === "int" ? 0 : 2)
                            : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(meta.total || 0) > 100 && (
            <div className="flex justify-center gap-2 p-3 border-t border-slate-100">
              <button
                disabled={page <= 1}
                onClick={() => load(page - 1)}
                className="px-3 py-1 text-xs rounded border disabled:opacity-40"
              >
                Trước
              </button>
              <span className="text-xs text-slate-500 self-center">
                Trang {page}
              </span>
              <button
                onClick={() => load(page + 1)}
                className="px-3 py-1 text-xs rounded border"
              >
                Sau
              </button>
            </div>
          )}
        </div>
      )}
      <ColumnCustomizer
        open={colOpen}
        tabKey={tabKey}
        columns={allCols}
        onClose={() => setColOpen(false)}
        onApply={(st) => setColState(st)}
      />
    </div>
  );
}
