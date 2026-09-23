"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Summary = {
  supplierId: string;
  supplierName?: string;
  opening: number;
  phatSinh?: number;
  tonsNhan?: number;
  paid: number;
  increase: number;
  closing: number;
};

function fmtMoney(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
}
function fmtTons(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

export default function PayablesPage() {
  const year = new Date().getFullYear();
  const [summary, setSummary] = useState<Summary[]>([]);
  const [formula, setFormula] = useState("");
  const [meta, setMeta] = useState<{ priceRows?: number; accrualLines?: number }>(
    {}
  );
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr("");
    try {
      // Prefer finance path; fallback reports
      let res = await fetch(`/api/v1/finance/payables?year=${year}&pageSize=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        res = await fetch(`/api/v1/reports/payables?year=${year}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải công nợ");
        return;
      }
      const data = json.data || {};
      setSummary(data.summary || []);
      setFormula(data.formula || "");
      setMeta(json.meta || {});
    } catch {
      setErr("Không kết nối API");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return summary;
    return summary.filter(
      (r) =>
        (r.supplierName || "").toLowerCase().includes(s) ||
        r.supplierId.toLowerCase().includes(s)
    );
  }, [summary, q]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, r) => ({
          opening: a.opening + (r.opening || 0),
          phatSinh: a.phatSinh + (r.phatSinh || 0),
          paid: a.paid + (r.paid || 0),
          increase: a.increase + (r.increase || 0),
          closing: a.closing + (r.closing || 0),
          tons: a.tons + (r.tonsNhan || 0),
        }),
        { opening: 0, phatSinh: 0, paid: 0, increase: 0, closing: 0, tons: 0 }
      ),
    [filtered]
  );

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Công nợ NCC</h2>
          <p className="text-xs text-slate-500">
            Năm {year}
            {meta.priceRows != null ? ` · ${meta.priceRows} giá mua` : ""}
            {meta.accrualLines != null
              ? ` · ${meta.accrualLines} dòng phát sinh`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
      </div>

      {formula && (
        <div className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {formula}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          ["Đầu kỳ", totals.opening],
          ["Phát sinh nhận", totals.phatSinh],
          ["ĐC tăng", totals.increase],
          ["Thanh toán", totals.paid],
          ["Cuối kỳ", totals.closing],
        ].map(([l, v]) => (
          <div
            key={String(l)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm"
          >
            <div className="text-[10px] uppercase text-slate-500 font-semibold">
              {l}
            </div>
            <div className="text-sm font-bold tabular-nums text-slate-800">
              {fmtMoney(Number(v))}
            </div>
          </div>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm NCC…"
        className="w-full max-w-md px-3 py-2 text-sm border border-slate-200 rounded-lg"
      />

      {err && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
      {loading ? (
        <div className="text-center text-slate-400 py-10 text-sm">Đang tải…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs">
                <th className="px-3 py-2.5 text-left font-semibold">NCC</th>
                <th className="px-3 py-2.5 text-right font-semibold">Đầu kỳ</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Phát sinh (nhận×giá)
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Tấn nhận</th>
                <th className="px-3 py-2.5 text-right font-semibold">ĐC tăng</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thanh toán</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cuối kỳ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.supplierId}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.supplierName || r.supplierId}</div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {r.supplierId}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.opening)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-medium">
                    {fmtMoney(r.phatSinh || 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {fmtTons(r.tonsNhan || 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.increase)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                    {fmtMoney(r.paid)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-bold ${
                      r.closing > 0 ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {fmtMoney(r.closing)}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-10 text-slate-400 text-sm"
                  >
                    Không có dữ liệu công nợ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
