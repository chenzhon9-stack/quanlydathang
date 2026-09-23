"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Summary = {
  supplierId: string;
  supplierName?: string;
  coDuDauNam?: boolean;
  duDauNam?: number;
  duDauKy?: number;
  opening: number;
  phatSinh?: number;
  phaiTraTrongKy?: number;
  tonsNhan?: number;
  paid: number;
  increase: number;
  chietKhau?: number;
  doiTru?: number;
  dieuChinhGiam?: number;
  closing: number;
  duCuoi?: number;
  soDongThieuGia?: number;
};

function fmtMoney(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
}
function fmtTons(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

function defaultPeriod() {
  const y = new Date().getFullYear();
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return { from: `${y}-01-01`, to: `${y}-${m}-${d}`, year: y };
}

export default function PayablesPage() {
  const init = defaultPeriod();
  const [fromDate, setFromDate] = useState(init.from);
  const [toDate, setToDate] = useState(init.to);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [formula, setFormula] = useState("");
  const [meta, setMeta] = useState<{
    priceRows?: number;
    soDongThieuGiaTong?: number;
    fromDate?: string;
    toDate?: string;
    year?: number;
  }>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams({
        fromDate,
        toDate,
        year: fromDate.slice(0, 4),
        pageSize: "500",
      });
      let res = await fetch(`/api/v1/finance/payables?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        res = await fetch(`/api/v1/reports/payables?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải công nợ");
        setSummary([]);
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
  }, [fromDate, toDate]);

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
          duDauKy: a.duDauKy + (r.duDauKy ?? r.opening ?? 0),
          phaiTra: a.phaiTra + (r.phaiTraTrongKy ?? r.phatSinh ?? 0),
          paid: a.paid + (r.paid || 0),
          increase: a.increase + (r.increase || 0),
          closing: a.closing + (r.duCuoi ?? r.closing ?? 0),
          tons: a.tons + (r.tonsNhan || 0),
          thieuGia: a.thieuGia + (r.soDongThieuGia || 0),
        }),
        {
          duDauKy: 0,
          phaiTra: 0,
          paid: 0,
          increase: 0,
          closing: 0,
          tons: 0,
          thieuGia: 0,
        }
      ),
    [filtered]
  );

  function setYearPreset(year: number) {
    const cy = new Date().getFullYear();
    setFromDate(`${year}-01-01`);
    if (year === cy) {
      const now = new Date();
      setToDate(
        `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
      );
    } else {
      setToDate(`${year}-12-31`);
    }
  }

  const year = Number(fromDate.slice(0, 4)) || init.year;

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Công nợ NCC</h2>
          <p className="text-xs text-slate-500">
            Đối chiếu theo kỳ (V21) · {meta.fromDate || fromDate} →{" "}
            {meta.toDate || toDate}
            {meta.priceRows != null ? ` · ${meta.priceRows} giá mua` : ""}
            {meta.soDongThieuGiaTong
              ? ` · ${meta.soDongThieuGiaTong} dòng thiếu giá`
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

      {/* Kỳ tính */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-2">
        <div className="text-xs font-semibold text-slate-600 uppercase">
          Kỳ tính công nợ (cùng năm)
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-500">
            Từ ngày
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="block mt-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg"
            />
          </label>
          <label className="text-xs text-slate-500">
            Đến ngày
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="block mt-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg"
            />
          </label>
          <div className="flex gap-1 pb-0.5">
            {[year - 1, year, year === init.year ? null : init.year]
              .filter((y, i, a) => y && a.indexOf(y) === i)
              .map((y) => (
                <button
                  key={y as number}
                  type="button"
                  onClick={() => setYearPreset(y as number)}
                  className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-slate-50"
                >
                  Năm {y}
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                setFromDate(`${year}-01-01`);
                setToDate(`${year}-12-31`);
              }}
              className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-slate-50"
            >
              Cả năm {year}
            </button>
            <button
              type="button"
              onClick={load}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-blue-600 text-white"
            >
              Áp dụng
            </button>
          </div>
        </div>
      </div>

      {formula && (
        <div className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {formula}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          ["Dư đầu kỳ", totals.duDauKy],
          ["Phải trả trong kỳ", totals.phaiTra],
          ["ĐC tăng", totals.increase],
          ["Thanh toán", totals.paid],
          ["Dư cuối kỳ", totals.closing],
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
                <th className="px-3 py-2.5 text-right font-semibold">Dư đầu năm</th>
                <th className="px-3 py-2.5 text-right font-semibold">Dư đầu kỳ</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Phải trả (nhận×giá)
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Tấn nhận</th>
                <th className="px-3 py-2.5 text-right font-semibold">ĐC tăng</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thanh toán</th>
                <th className="px-3 py-2.5 text-right font-semibold">CK/ĐT/ĐC↓</th>
                <th className="px-3 py-2.5 text-right font-semibold">Dư cuối</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thiếu giá</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.supplierId}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {r.supplierName || r.supplierId}
                      {!r.coDuDauNam && (
                        <span
                          className="ml-1 text-[10px] text-amber-600"
                          title="Chưa có dư đầu năm"
                        >
                          !
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {r.supplierId}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.duDauNam ?? r.opening ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtMoney(r.duDauKy ?? r.opening ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-medium">
                    {fmtMoney(r.phaiTraTrongKy ?? r.phatSinh ?? 0)}
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
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {fmtMoney(
                      (r.chietKhau || 0) +
                        (r.doiTru || 0) +
                        (r.dieuChinhGiam || 0)
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-bold ${
                      (r.duCuoi ?? r.closing) > 0
                        ? "text-red-600"
                        : "text-slate-800"
                    }`}
                  >
                    {fmtMoney(r.duCuoi ?? r.closing)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600">
                    {r.soDongThieuGia || 0}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={10}
                    className="text-center py-10 text-slate-400 text-sm"
                  >
                    Không có dữ liệu công nợ trong kỳ
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
