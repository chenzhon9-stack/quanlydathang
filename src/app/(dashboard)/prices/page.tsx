"use client";

/**
 * Giá mua (DM_GiaMua) — parity V21
 * - Mốc giá: MaNCC + MaHH + Makv + TuNgay → DonGia
 * - Trùng khóa → cập nhật DonGia (upsert)
 * - Ngưng: HoatDong=false (không xóa dòng)
 * - resolveDonGiaMua: TuNgay ≤ ngày nhận, ưu tiên Makv khớp rồi Makv trống
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTION, clientHasAny, readClientUser } from "@/lib/nav-access";
import { matchSearch } from "@/components/ListToolbar";

type GiaMua = {
  idGia?: string;
  maNcc: string;
  maHh: string;
  makv: string;
  donGia: number;
  tuNgay: string;
  active: boolean;
  ghiChu?: string;
};

type MasterOpt = { id: string; label: string };

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("vi-VN");
}

function todayYmd() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function apiJson(
  url: string,
  init?: RequestInit
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } }> {
  const token = localStorage.getItem("token") || "";
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  return res.json();
}

export default function PricesPage() {
  const user = readClientUser();
  const canView = clientHasAny(user, [
    "PURCHASE_PRICE_VIEW",
    "PAYABLE_VIEW",
    "*",
  ]);
  const canUpdate = clientHasAny(user, ["PURCHASE_PRICE_UPDATE", "*"]);

  const [items, setItems] = useState<GiaMua[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [filterNcc, setFilterNcc] = useState("");
  const [filterHh, setFilterHh] = useState("");

  const [nccOpts, setNccOpts] = useState<MasterOpt[]>([]);
  const [hhOpts, setHhOpts] = useState<MasterOpt[]>([]);
  const [kvOpts, setKvOpts] = useState<MasterOpt[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GiaMua | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    maNcc: "",
    maHh: "",
    makv: "",
    donGia: "",
    tuNgay: todayYmd(),
    ghiChu: "",
    active: true,
  });

  const loadMasters = useCallback(async () => {
    try {
      const [ncc, hh, kv] = await Promise.all([
        apiJson("/api/v1/masters?type=NCC"),
        apiJson("/api/v1/masters?type=HH"),
        apiJson("/api/v1/masters?type=KV"),
      ]);
      const mapItems = (json: {
        success?: boolean;
        data?: { items?: Record<string, unknown>[] };
      }): MasterOpt[] => {
        if (!json.success) return [];
        const rows = json.data?.items || [];
        return rows
          .map((r) => {
            const id = String(
              r.MaNCC || r.MaHH || r.Makv || r.MaKV || r.id || ""
            ).trim();
            const label =
              String(
                r.TenNCC ||
                  r.TenHangHoa ||
                  r.Khuvuc ||
                  r.Ten ||
                  r.label ||
                  id
              ).trim() || id;
            return id ? { id, label: `${id} — ${label}` } : null;
          })
          .filter((x): x is MasterOpt => !!x);
      };
      setNccOpts(mapItems(ncc as never));
      setHhOpts(mapItems(hh as never));
      setKvOpts(mapItems(kv as never));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setErr("Không có quyền xem giá mua");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (activeOnly) qs.set("activeOnly", "1");
      else qs.set("activeOnly", "0");
      if (filterNcc) qs.set("supplierId", filterNcc);
      if (filterHh) qs.set("productId", filterHh);
      const json = await apiJson(`/api/v1/finance/prices?${qs}`);
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải giá mua");
        setItems([]);
        return;
      }
      const data = json.data as { items?: GiaMua[] };
      setItems(data?.items || []);
    } catch {
      setErr("Không kết nối được API");
    } finally {
      setLoading(false);
    }
  }, [canView, activeOnly, filterNcc, filterHh]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    load();
  }, [load]);

  const nameNcc = useMemo(() => {
    const m = new Map<string, string>();
    nccOpts.forEach((o) => m.set(o.id, o.label));
    return m;
  }, [nccOpts]);
  const nameHh = useMemo(() => {
    const m = new Map<string, string>();
    hhOpts.forEach((o) => m.set(o.id, o.label));
    return m;
  }, [hhOpts]);
  const nameKv = useMemo(() => {
    const m = new Map<string, string>();
    kvOpts.forEach((o) => m.set(o.id, o.label));
    return m;
  }, [kvOpts]);

  const filtered = useMemo(() => {
    return items.filter((r) => {
      const hay = [
        r.idGia,
        r.maNcc,
        r.maHh,
        r.makv,
        nameNcc.get(r.maNcc) || "",
        nameHh.get(r.maHh) || "",
        nameKv.get(r.makv) || "",
        String(r.donGia),
        r.tuNgay,
      ].join(" ");
      return matchSearch(hay, search);
    });
  }, [items, search, nameNcc, nameHh, nameKv]);

  function openCreate() {
    setEditing(null);
    setForm({
      maNcc: filterNcc || "",
      maHh: filterHh || "",
      makv: "",
      donGia: "",
      tuNgay: todayYmd(),
      ghiChu: "",
      active: true,
    });
    setModalOpen(true);
  }

  function openEdit(row: GiaMua) {
    setEditing(row);
    setForm({
      maNcc: row.maNcc,
      maHh: row.maHh,
      makv: row.makv || "",
      donGia: String(row.donGia ?? ""),
      tuNgay: row.tuNgay || todayYmd(),
      ghiChu: row.ghiChu || "",
      active: row.active !== false,
    });
    setModalOpen(true);
  }

  async function saveForm() {
    const donGia = Number(String(form.donGia).replace(/\./g, "").replace(",", "."));
    if (!form.maNcc || !form.maHh) {
      alert("Chọn NCC và Hàng hóa");
      return;
    }
    if (!form.tuNgay) {
      alert("Nhập Từ ngày (mốc giá)");
      return;
    }
    if (!(donGia >= 0) || !Number.isFinite(donGia)) {
      alert("Đơn giá không hợp lệ");
      return;
    }
    setBusy(true);
    try {
      const body = {
        idGia: editing?.idGia,
        maNcc: form.maNcc,
        maHh: form.maHh,
        makv: form.makv,
        donGia,
        tuNgay: form.tuNgay,
        ghiChu: form.ghiChu,
        active: form.active,
      };
      const json = await apiJson("/api/v1/finance/prices", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!json.success) {
        alert(json.error?.message || "Lưu thất bại");
        return;
      }
      const r = json.data as { idGia?: string; created?: boolean };
      alert(
        r?.created
          ? `Đã thêm mốc giá ${r.idGia || ""}`
          : `Đã cập nhật mốc giá ${r.idGia || editing?.idGia || ""}`
      );
      setModalOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(row: GiaMua) {
    if (!row.idGia) return;
    if (!confirm(`Ngưng hiệu lực giá ${row.idGia}?`)) return;
    const json = await apiJson(
      `/api/v1/finance/prices/${encodeURIComponent(row.idGia)}`,
      { method: "DELETE" }
    );
    if (!json.success) {
      alert(json.error?.message || "Không ngưng được");
      return;
    }
    load();
  }

  if (!canView) {
    return (
      <div className="p-6 text-sm text-slate-600">
        Bạn không có quyền xem giá mua (cần PURCHASE_PRICE_VIEW).
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Giá mua NCC</h2>
          <p className="text-xs text-slate-500">
            DM_GiaMua — mốc theo NCC + Hàng hóa + Khu vực + Từ ngày ·{" "}
            {filtered.length}/{items.length} dòng
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tải lại
          </button>
          {canUpdate && (
            <button
              type="button"
              onClick={openCreate}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
            >
              + Thêm mốc giá
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <label className="text-xs text-slate-600">
          Tìm
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="NCC, HH, khu vực…"
            className="mt-0.5 block w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          NCC
          <select
            value={filterNcc}
            onChange={(e) => setFilterNcc(e.target.value)}
            className="mt-0.5 block w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— Tất cả —</option>
            {nccOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Hàng hóa
          <select
            value={filterHh}
            onChange={(e) => setFilterHh(e.target.value)}
            className="mt-0.5 block w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— Tất cả —</option>
            {hhOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-700 pb-1.5">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Chỉ đang hiệu lực
        </label>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
      {loading && (
        <div className="text-sm text-slate-500">Đang tải giá mua…</div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((r) => (
          <div
            key={r.idGia || `${r.maNcc}-${r.maHh}-${r.tuNgay}`}
            className={`rounded-xl border p-3 shadow-sm ${
              r.active
                ? "bg-white border-slate-200"
                : "bg-slate-50 border-slate-200 opacity-70"
            }`}
          >
            <div className="flex justify-between gap-2">
              <span className="text-xs font-mono text-slate-500">
                {r.idGia || "—"}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  r.active
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {r.active ? "Hiệu lực" : "Ngưng"}
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-800">
              {nameNcc.get(r.maNcc) || r.maNcc}
            </div>
            <div className="text-sm text-slate-700">
              {nameHh.get(r.maHh) || r.maHh}
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-slate-500">
                Từ {r.tuNgay || "—"}
                {r.makv ? ` · KV ${r.makv}` : ""}
              </span>
              <span className="font-bold text-blue-700">
                {fmtMoney(r.donGia)}
              </span>
            </div>
            {canUpdate && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="px-2.5 py-1 text-[11px] rounded bg-slate-800 text-white"
                >
                  Sửa
                </button>
                {r.active && (
                  <button
                    type="button"
                    onClick={() => deactivate(r)}
                    className="px-2.5 py-1 text-[11px] rounded bg-amber-500 text-white"
                  >
                    Ngưng
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-8">
            Không có mốc giá
          </p>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left">ID</th>
                <th className="px-3 py-2.5 text-left">NCC</th>
                <th className="px-3 py-2.5 text-left">Hàng hóa</th>
                <th className="px-3 py-2.5 text-left">Khu vực</th>
                <th className="px-3 py-2.5 text-right">Đơn giá</th>
                <th className="px-3 py-2.5 text-left">Từ ngày</th>
                <th className="px-3 py-2.5 text-center">TT</th>
                <th className="px-3 py-2.5 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.idGia || `${r.maNcc}-${r.maHh}-${r.tuNgay}`}
                  className={`border-t border-slate-100 ${
                    r.active ? "" : "bg-slate-50 text-slate-500"
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.idGia || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {nameNcc.get(r.maNcc)?.split(" — ")[1] || r.maNcc}
                    </div>
                    <div className="text-[11px] text-slate-400">{r.maNcc}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {nameHh.get(r.maHh)?.split(" — ")[1] || r.maHh}
                    </div>
                    <div className="text-[11px] text-slate-400">{r.maHh}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.makv
                      ? nameKv.get(r.makv)?.split(" — ")[1] || r.makv
                      : "— (mặc định)"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtMoney(r.donGia)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.tuNgay}</td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {r.active ? "HL" : "Ngưng"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canUpdate && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="px-2 py-1 text-[11px] rounded bg-slate-800 text-white"
                        >
                          Sửa
                        </button>
                        {r.active && (
                          <button
                            type="button"
                            onClick={() => deactivate(r)}
                            className="px-2 py-1 text-[11px] rounded bg-amber-500 text-white"
                          >
                            Ngưng
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-10">
            Không có mốc giá
          </p>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        Rule V21: khi tính công nợ / phát sinh, lấy mốc có{" "}
        <strong>TuNgay ≤ ngày nhận</strong>, ưu tiên đúng Makv rồi Makv trống;
        mốc mới nhất trong pool. Thêm mốc cùng NCC+HH+KV+TuNgay sẽ{" "}
        <strong>cập nhật</strong> đơn giá (không nhân bản).
      </p>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModalOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-bold text-slate-800">
                {editing ? `Sửa giá ${editing.idGia}` : "Thêm mốc giá mua"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Khóa: NCC + Hàng hóa + Khu vực + Từ ngày
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block text-xs text-slate-600">
                Nhà cung cấp *
                <select
                  value={form.maNcc}
                  disabled={!!editing}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maNcc: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm disabled:bg-slate-50"
                >
                  <option value="">— Chọn NCC —</option>
                  {nccOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-600">
                Hàng hóa *
                <select
                  value={form.maHh}
                  disabled={!!editing}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maHh: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm disabled:bg-slate-50"
                >
                  <option value="">— Chọn HH —</option>
                  {hhOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-600">
                Khu vực / công trình (để trống = mặc định mọi KV)
                <select
                  value={form.makv}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, makv: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">— Mặc định (trống) —</option>
                  {kvOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-slate-600">
                  Đơn giá *
                  <input
                    value={form.donGia}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, donGia: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0"
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Từ ngày *
                  <input
                    type="date"
                    value={form.tuNgay}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, tuNgay: e.target.value }))
                    }
                    className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="block text-xs text-slate-600">
                Ghi chú
                <input
                  value={form.ghiChu}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ghiChu: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </label>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, active: e.target.checked }))
                    }
                  />
                  Đang hiệu lực
                </label>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={busy || !canUpdate}
                onClick={saveForm}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {busy ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
