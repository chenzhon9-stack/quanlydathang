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

type DetailData = {
  supplierId: string;
  supplierName: string;
  fromDate: string;
  toDate: string;
  receiveLines: Array<{
    kind: string;
    bucket: string;
    detailId: string;
    orderId: string;
    date: string;
    productName: string;
    makv: string;
    tons: number;
    donGia: number;
    thieuGia: boolean;
    thanhTien: number;
  }>;
  ledgerLines: Array<{
    kind: string;
    bucket: string;
    id: string;
    date: string;
    type: string;
    amount: number;
    documentNo: string;
    description: string;
  }>;
};

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("vi-VN");
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
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<"nhan" | "so_co">("nhan");

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
      setSummary(json.data?.summary || []);
      setFormula(json.data?.formula || "");
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

  async function openDetail(r: Summary) {
    const token = localStorage.getItem("token");
    if (!token) return;
    setDetailLoading(true);
    setDetailTab("nhan");
    try {
      const qs = new URLSearchParams({ fromDate, toDate, year: fromDate.slice(0, 4) });
      const res = await fetch(
        `/api/v1/finance/payables/${encodeURIComponent(r.supplierId)}?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Lỗi chi tiết");
        return;
      }
      setDetail(json.data);
    } catch {
      alert("Không tải được chi tiết");
    } finally {
      setDetailLoading(false);
    }
  }

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
          duDauNam: a.duDauNam + (r.duDauNam ?? r.opening ?? 0),
          duDauKy: a.duDauKy + (r.duDauKy ?? 0),
          phaiTra: a.phaiTra + (r.phaiTraTrongKy ?? r.phatSinh ?? 0),
          paid: a.paid + (r.paid || 0),
          increase: a.increase + (r.increase || 0),
          ck: a.ck + (r.chietKhau || 0),
          dt: a.dt + (r.doiTru || 0),
          dcg: a.dcg + (r.dieuChinhGiam || 0),
          closing: a.closing + (r.duCuoi ?? r.closing ?? 0),
        }),
        {
          duDauNam: 0,
          duDauKy: 0,
          phaiTra: 0,
          paid: 0,
          increase: 0,
          ck: 0,
          dt: 0,
          dcg: 0,
          closing: 0,
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
        `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate()
        ).padStart(2, "0")}`
      );
    } else setToDate(`${year}-12-31`);
  }

  const year = Number(fromDate.slice(0, 4)) || init.year;

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Công nợ NCC</h2>
          <p className="text-xs text-slate-500">
            Đối chiếu theo kỳ (V21) · {String(meta.fromDate || fromDate)} →{" "}
            {String(meta.toDate || toDate)}
            {meta.priceRows != null ? ` · ${String(meta.priceRows)} giá mua` : ""}
            {meta.soDongThieuGiaTong
              ? ` · ${String(meta.soDongThieuGiaTong)} dòng thiếu giá`
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
          <button
            type="button"
            onClick={() => setYearPreset(year - 1)}
            className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200"
          >
            Năm {year - 1}
          </button>
          <button
            type="button"
            onClick={() => setYearPreset(year)}
            className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200"
          >
            Năm {year}
          </button>
          <button
            type="button"
            onClick={() => {
              setFromDate(`${year}-01-01`);
              setToDate(`${year}-12-31`);
            }}
            className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200"
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

      {formula && (
        <div className="text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          {formula}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {[
          ["Dư đầu kỳ", totals.duDauKy],
          ["Phải trả trong kỳ", totals.phaiTra],
          ["Thanh toán", totals.paid],
          ["CK + ĐT + ĐC↓", totals.ck + totals.dt + totals.dcg],
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
                <th className="px-3 py-2.5 text-right font-semibold">Phải trả</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tấn nhận</th>
                <th className="px-3 py-2.5 text-right font-semibold">ĐC tăng</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thanh toán</th>
                <th className="px-3 py-2.5 text-right font-semibold">CK</th>
                <th className="px-3 py-2.5 text-right font-semibold">Đối trừ</th>
                <th className="px-3 py-2.5 text-right font-semibold">ĐC giảm</th>
                <th className="px-3 py-2.5 text-right font-semibold">Dư cuối</th>
                <th className="px-3 py-2.5 text-right font-semibold">Thiếu giá</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
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
                        <span className="ml-1 text-amber-500 text-[10px]" title="Chưa có dư đầu năm">
                          ▲
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
                    {fmtMoney(r.duDauKy ?? 0)}
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.chietKhau || 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.doiTru || 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(r.dieuChinhGiam || 0)}
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
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openDetail(r)}
                      disabled={detailLoading}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
                    >
                      Chi tiết
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length > 0 && (
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">TỔNG ({filtered.length} NCC)</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.duDauNam)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.duDauKy)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.phaiTra)}
                  </td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.paid)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.ck)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.dt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.dcg)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(totals.closing)}
                  </td>
                  <td colSpan={2} />
                </tr>
              )}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={13}
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

      {/* Modal chi tiết */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="font-bold text-slate-800">
                  Chi tiết — {detail.supplierName}
                </h3>
                <p className="text-xs text-slate-500">
                  {detail.supplierId} · {detail.fromDate} → {detail.toDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-slate-400 hover:text-slate-700 text-lg px-2"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-1 px-4 pt-2">
              <button
                type="button"
                onClick={() => setDetailTab("nhan")}
                className={`px-3 py-1.5 text-xs rounded-lg border ${
                  detailTab === "nhan"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white border-slate-200"
                }`}
              >
                Thực nhận × giá ({detail.receiveLines.length})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab("so_co")}
                className={`px-3 py-1.5 text-xs rounded-lg border ${
                  detailTab === "so_co"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white border-slate-200"
                }`}
              >
                Sổ Có / phát sinh ({detail.ledgerLines.length})
              </button>
            </div>
            <div className="overflow-auto p-4 flex-1">
              {detailTab === "nhan" ? (
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-2 py-1.5 text-left">Ngày nhận</th>
                      <th className="px-2 py-1.5 text-left">Kỳ</th>
                      <th className="px-2 py-1.5 text-left">Hàng</th>
                      <th className="px-2 py-1.5 text-left">Makv</th>
                      <th className="px-2 py-1.5 text-right">Tấn</th>
                      <th className="px-2 py-1.5 text-right">Đơn giá</th>
                      <th className="px-2 py-1.5 text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.receiveLines.map((l) => (
                      <tr
                        key={l.detailId + l.date}
                        className={`border-t ${
                          l.thieuGia ? "bg-amber-50" : ""
                        }`}
                      >
                        <td className="px-2 py-1.5">{l.date}</td>
                        <td className="px-2 py-1.5">
                          {l.bucket === "trongKy" ? "Trong kỳ" : "Trước kỳ"}
                        </td>
                        <td className="px-2 py-1.5">{l.productName}</td>
                        <td className="px-2 py-1.5 font-mono">{l.makv || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmtTons(l.tons)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {l.thieuGia ? (
                            <span className="text-amber-600">thiếu giá</span>
                          ) : (
                            fmtMoney(l.donGia)
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {fmtMoney(l.thanhTien)}
                        </td>
                      </tr>
                    ))}
                    {!detail.receiveLines.length && (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-center py-6 text-slate-400"
                        >
                          Không có dòng nhận trong năm đến hết kỳ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-2 py-1.5 text-left">Ngày CT</th>
                      <th className="px-2 py-1.5 text-left">Kỳ</th>
                      <th className="px-2 py-1.5 text-left">Loại</th>
                      <th className="px-2 py-1.5 text-left">Chứng từ</th>
                      <th className="px-2 py-1.5 text-left">Diễn giải</th>
                      <th className="px-2 py-1.5 text-right">Số tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.ledgerLines.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-2 py-1.5">{l.date}</td>
                        <td className="px-2 py-1.5">
                          {l.bucket === "trongKy" ? "Trong kỳ" : "Trước kỳ"}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          {l.type}
                        </td>
                        <td className="px-2 py-1.5">{l.documentNo || "—"}</td>
                        <td className="px-2 py-1.5 max-w-[180px] truncate">
                          {l.description || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                          {fmtMoney(l.amount)}
                        </td>
                      </tr>
                    ))}
                    {!detail.ledgerLines.length && (
                      <tr>
                        <td
                          colSpan={6}
                          className="text-center py-6 text-slate-400"
                        >
                          Không có dòng sổ Có trong năm đến hết kỳ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
