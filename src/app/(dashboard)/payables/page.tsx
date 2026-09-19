"use client";

import { useEffect, useState } from "react";

/**
 * Tab Công nợ NCC — skill Permission: ADMIN, MANAGER, PURCHASE, ACCOUNTANT
 * Actions V21: Thêm chi tiết, Lọc, Chi tiết (mỗi dòng), Xuất Excel trong modal
 */
export default function PayablesPage() {
  const [summary, setSummary] = useState<any[]>([]);
  const [payables, setPayables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);
  const [selected, setSelected] = useState<{
    supplierId: string;
    supplierName?: string;
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    fetch(`/api/v1/finance/payables?year=${year}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setSummary(json.data?.summary || []);
          setPayables(json.data?.payables || []);
        }
      })
      .finally(() => setLoading(false));
  }, [year]);

  function fmt(n: number) {
    return n.toLocaleString("vi-VN");
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Công nợ NCC</h2>
          <p className="text-xs text-slate-500">Sheet NCC_CongNo + NCC_DuDauNam · /api/v1/finance/payables</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white"
          >
            <option value={2026}>Năm 2026</option>
            <option value={2025}>Năm 2025</option>
          </select>
          <button
            onClick={() => alert("[Mock] Lọc — loadCongNoSummary()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Lọc
          </button>
          <button
            onClick={() => alert("[Mock] Thêm chi tiết — openCongNoPhatSinhFromTab()")}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
          >
            + Thêm chi tiết
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải...</div>
      ) : (
        <>
          {/* Summary table — desktop & mobile scroll */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left font-semibold">Mã NCC</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Nhà cung cấp</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Dư đầu</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Đã TT / CK</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Tăng</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Dư cuối</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr
                      key={s.supplierId}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-blue-700">
                        {s.supplierId}
                      </td>
                      <td className="px-3 py-2.5 font-medium max-w-[200px] truncate">
                        {s.supplierName || s.supplierId}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fmt(s.opening ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                        {fmt(s.paid ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                        {fmt(s.increase ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {fmt(s.closing ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() =>
                            setSelected({
                              supplierId: s.supplierId,
                              supplierName: s.supplierName,
                            })
                          }
                          className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500"
                        >
                          Chi tiết
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">
                Không có dữ liệu công nợ
              </div>
            )}
          </div>

          {/* Modal chi tiết công nợ */}
          {selected && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
              <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800">Sổ chi tiết công nợ</h3>
                    <p className="text-xs text-slate-500">
                      {selected.supplierName || selected.supplierId}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-slate-500 hover:text-slate-800 text-lg px-2"
                  >
                    ×
                  </button>
                </div>
                <div className="px-4 py-2 flex gap-2 border-b border-slate-100">
                  <button
                    onClick={() =>
                      alert("[Mock] Thêm chi tiết — openCongNoPhatSinhForm()")
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white"
                  >
                    + Thêm chi tiết
                  </button>
                  <button
                    onClick={() => alert("[Mock] Xuất Excel — exportCongNoDetailXlsx()")}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-white"
                  >
                    Xuất Excel
                  </button>
                </div>
                <div className="overflow-auto flex-1 p-4">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-600">
                        <th className="px-2 py-2 text-left">Ngày</th>
                        <th className="px-2 py-2 text-left">Loại</th>
                        <th className="px-2 py-2 text-right">Số tiền</th>
                        <th className="px-2 py-2 text-left">Mô tả</th>
                        <th className="px-2 py-2 text-right">HĐ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payables
                        .filter((p) => p.supplierId === selected.supplierId)
                        .map((p) => (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="px-2 py-2 text-xs">{p.date}</td>
                            <td className="px-2 py-2 text-xs">{p.type}</td>
                            <td className="px-2 py-2 text-right tabular-nums font-medium">
                              {fmt(p.amount)}
                            </td>
                            <td className="px-2 py-2 text-xs text-slate-500 truncate max-w-[120px]">
                              {p.description || p.documentNo || "—"}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <button
                                onClick={() =>
                                  alert(`[Mock] Copy phát sinh ${p.id}`)
                                }
                                className="text-[11px] text-blue-600"
                              >
                                Copy
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {payables.filter((p) => p.supplierId === selected.supplierId)
                    .length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-6">
                      Chưa có phát sinh
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
