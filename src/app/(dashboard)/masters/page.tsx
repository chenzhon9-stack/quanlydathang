"use client";

import { useCallback, useEffect, useState } from "react";

const TYPES = [
  { key: "NCC", label: "Nhà cung cấp" },
  { key: "KH", label: "Khách hàng" },
  { key: "HH", label: "Hàng hóa" },
  { key: "XE", label: "Xe" },
  { key: "HTVT", label: "Hình thức VT" },
  { key: "DVT", label: "Đơn vị VT" },
  { key: "KV", label: "Khu vực" },
  { key: "NCC_HH", label: "NCC–Hàng" },
] as const;

export default function MastersPage() {
  const [type, setType] = useState<(typeof TYPES)[number]["key"]>("NCC");
  const [headers, setHeaders] = useState<string[]>([]);
  const [items, setItems] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async (t: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/v1/masters?type=${t}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải danh mục");
        setItems([]);
        return;
      }
      setHeaders(json.data.headers || []);
      setItems(json.data.items || []);
    } catch {
      setErr("Không kết nối API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(type);
  }, [type, load]);

  const filtered = q.trim()
    ? items.filter((row) =>
        Object.values(row).some((v) =>
          String(v).toLowerCase().includes(q.trim().toLowerCase())
        )
      )
    : items;

  const displayCols = headers.slice(0, 8);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Danh mục</h2>
        <p className="text-xs text-slate-500">
          Master data từ Google Sheet · chỉ đọc (phase hiện tại)
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
              type === t.key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm trong danh mục…"
          className="flex-1 max-w-sm px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        <button
          onClick={() => load(type)}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
        <span className="text-xs text-slate-400">{filtered.length} dòng</span>
      </div>

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
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                {displayCols.map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((row, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  {displayCols.map((h) => (
                    <td key={h} className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {String(row[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <div className="text-xs text-slate-400 px-3 py-2 border-t">
              Hiển thị 200 / {filtered.length} — thu hẹp bằng ô tìm kiếm
            </div>
          )}
          {!filtered.length && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          )}
        </div>
      )}
    </div>
  );
}
