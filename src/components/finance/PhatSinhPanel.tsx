"use client";

/**
 * Sổ phát sinh công nợ NCC — parity V21 listCongNoPhatSinh / save / void / copy
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { clientHasAny, readClientUser } from "@/lib/nav-access";

type Entry = {
  idCn: string;
  ngayCT: string;
  maNcc: string;
  loai: string;
  soTien: number;
  maHh: string;
  makv: string;
  soChungTu: string;
  dienGiai: string;
  active: boolean;
  tenNcc?: string;
  tenHh?: string;
  tenKv?: string;
};

const LOAI_OPTS = [
  { id: "THANH_TOAN", label: "Thanh toán" },
  { id: "CHIET_KHAU", label: "Chiết khấu" },
  { id: "DOI_TRU", label: "Đối trừ" },
  { id: "DIEU_CHINH_TANG", label: "Điều chỉnh tăng" },
  { id: "DIEU_CHINH_GIAM", label: "Điều chỉnh giảm" },
  { id: "KHAC", label: "Khác" },
];

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("vi-VN");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PhatSinhPanel() {
  const user = readClientUser();
  const canWrite = clientHasAny(user, ["PAYABLE_CREATE", "*"]);
  const canVoid = clientHasAny(user, ["PAYABLE_CANCEL", "*"]);

  const y = new Date().getFullYear();
  const [fromDate, setFromDate] = useState(`${y}-01-01`);
  const [toDate, setToDate] = useState(todayYmd());
  const [filterNcc, setFilterNcc] = useState("");
  const [filterNccName, setFilterNccName] = useState("");
  const [filterLoai, setFilterLoai] = useState<string[]>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [nameNcc, setNameNcc] = useState<Record<string, string>>({});
  const [nameHh, setNameHh] = useState<Record<string, string>>({});
  const [nameKv, setNameKv] = useState<Record<string, string>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    maNcc: "",
    tenNcc: "",
    loai: "THANH_TOAN",
    soTien: "",
    ngayCT: todayYmd(),
    soChungTu: "",
    dienGiai: "",
    maHh: "",
    tenHh: "",
    makv: "",
    tenKv: "",
  });

  const loadMasters = useCallback(async () => {
    const token = localStorage.getItem("token") || "";
    const h = { Authorization: `Bearer ${token}` };
    try {
      const [ncc, hh, kv] = await Promise.all([
        fetch("/api/v1/masters?type=NCC", { headers: h }).then((r) => r.json()),
        fetch("/api/v1/masters?type=HH", { headers: h }).then((r) => r.json()),
        fetch("/api/v1/masters?type=KV", { headers: h }).then((r) => r.json()),
      ]);
      const map = (json: { data?: { items?: Array<{ id?: string; name?: string }> } }) => {
        const out: Record<string, string> = {};
        for (const it of json?.data?.items || []) {
          if (it.id) out[it.id] = it.name || it.id;
        }
        return out;
      };
      setNameNcc(map(ncc));
      setNameHh(map(hh));
      setNameKv(map(kv));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    const token = localStorage.getItem("token") || "";
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams({
        fromDate,
        toDate,
        year: fromDate.slice(0, 4) || String(y),
        onlyActive: "true",
      });
      if (filterNcc) qs.set("maNcc", filterNcc);
      filterLoai.forEach((l) => qs.append("loai", l));
      const res = await fetch(`/api/v1/finance/payables?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải sổ phát sinh");
        setItems([]);
        return;
      }
      setItems((json.data?.items || []) as Entry[]);
    } catch {
      setErr("Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, filterNcc, filterLoai, y]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  const rows = useMemo(
    () =>
      items.map((r) => ({
        ...r,
        tenNcc: nameNcc[r.maNcc] || r.maNcc,
        tenHh: r.maHh ? nameHh[r.maHh] || r.maHh : "",
        tenKv: r.makv ? nameKv[r.makv] || r.makv : "",
      })),
    [items, nameNcc, nameHh, nameKv]
  );

  function openCreate(copy?: Entry) {
    setForm({
      maNcc: copy?.maNcc || filterNcc || "",
      tenNcc: copy ? nameNcc[copy.maNcc] || copy.maNcc : filterNccName || "",
      loai: copy?.loai || "THANH_TOAN",
      soTien: copy ? String(copy.soTien) : "",
      ngayCT: todayYmd(),
      soChungTu: "",
      dienGiai: copy?.dienGiai || "",
      maHh: copy?.maHh || "",
      tenHh: copy?.maHh ? nameHh[copy.maHh] || copy.maHh : "",
      makv: copy?.makv || "",
      tenKv: copy?.makv ? nameKv[copy.makv] || copy.makv : "",
    });
    setFormOpen(true);
  }

  async function submitForm() {
    setBusy(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/v1/finance/payables", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          maNcc: form.maNcc,
          loai: form.loai,
          soTien: Number(String(form.soTien).replace(",", ".")),
          ngayCT: form.ngayCT,
          soChungTu: form.soChungTu,
          dienGiai: form.dienGiai,
          maHh: form.maHh,
          makv: form.makv,
          year: Number(form.ngayCT.slice(0, 4)) || y,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Lưu thất bại");
        return;
      }
      setFormOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function voidRow(idCn: string) {
    if (!confirm(`Hủy chứng từ ${idCn}?`)) return;
    const token = localStorage.getItem("token") || "";
    const res = await fetch(
      `/api/v1/finance/payables/${encodeURIComponent(idCn)}/void`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ year: Number(fromDate.slice(0, 4)) || y }),
      }
    );
    const json = await res.json();
    if (!json.success) {
      alert(json.error?.message || "Hủy thất bại");
      return;
    }
    load();
  }

  function toggleLoai(id: string) {
    setFilterLoai((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Từ ngày
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-0.5 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Đến ngày
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-0.5 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="min-w-[200px]">
          <div className="text-xs text-slate-600 mb-0.5">NCC</div>
          <MasterPicker
            type="NCC"
            value={filterNcc}
            displayName={filterNccName}
            placeholder="Tất cả NCC…"
            onChange={(id, name) => {
              setFilterNcc(id);
              setFilterNccName(name);
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          {LOAI_OPTS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => toggleLoai(o.id)}
              className={`px-2 py-1 text-[11px] rounded-lg border ${
                filterLoai.includes(o.id)
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-white text-slate-600 border-slate-300"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 border border-slate-300 hover:bg-slate-50"
        >
          ↻ Tải sổ
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500"
          >
            + Thêm phát sinh
          </button>
        )}
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700 text-left">
            <tr>
              <th className="px-3 py-2">Ngày CT</th>
              <th className="px-3 py-2">NCC</th>
              <th className="px-3 py-2">Loại</th>
              <th className="px-3 py-2 text-right">Số tiền</th>
              <th className="px-3 py-2">Hàng hóa</th>
              <th className="px-3 py-2">Khu vực</th>
              <th className="px-3 py-2">Số CT</th>
              <th className="px-3 py-2">Diễn giải</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  Đang tải…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  Bấm tải sổ để xem.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.idCn} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.ngayCT}</td>
                  <td className="px-3 py-2">{r.tenNcc}</td>
                  <td className="px-3 py-2">{r.loai}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtMoney(r.soTien)}
                  </td>
                  <td className="px-3 py-2">{r.tenHh || "—"}</td>
                  <td className="px-3 py-2">{r.tenKv || "—"}</td>
                  <td className="px-3 py-2">{r.soChungTu || "—"}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.dienGiai}>
                    {r.dienGiai || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.active ? (
                      <span className="text-emerald-700 text-xs font-medium">Hoạt động</span>
                    ) : (
                      <span className="text-slate-400 text-xs">Đã hủy</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openCreate(r)}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50"
                        >
                          Sao chép
                        </button>
                      )}
                      {canVoid && r.active && (
                        <button
                          type="button"
                          onClick={() => voidRow(r.idCn)}
                          className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                        >
                          Hủy
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Thêm phát sinh công nợ</h3>
              <button type="button" onClick={() => setFormOpen(false)} className="text-slate-400">
                ✕
              </button>
            </div>
            <div>
              <div className="text-xs text-slate-600 mb-0.5">NCC *</div>
              <MasterPicker
                type="NCC"
                value={form.maNcc}
                displayName={form.tenNcc}
                onChange={(id, name) =>
                  setForm((f) => ({ ...f, maNcc: id, tenNcc: name }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">
                Loại *
                <select
                  value={form.loai}
                  onChange={(e) => setForm((f) => ({ ...f, loai: e.target.value }))}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                >
                  {LOAI_OPTS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Ngày CT *
                <input
                  type="date"
                  value={form.ngayCT}
                  onChange={(e) => setForm((f) => ({ ...f, ngayCT: e.target.value }))}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </label>
            </div>
            <label className="text-xs text-slate-600 block">
              Số tiền *
              <input
                value={form.soTien}
                onChange={(e) => setForm((f) => ({ ...f, soTien: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                placeholder="0"
              />
            </label>
            <label className="text-xs text-slate-600 block">
              Số chứng từ
              <input
                value={form.soChungTu}
                onChange={(e) => setForm((f) => ({ ...f, soChungTu: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-600 mb-0.5">Hàng hóa</div>
                <MasterPicker
                  type="HH"
                  value={form.maHh}
                  displayName={form.tenHh}
                  placeholder="Tuỳ chọn…"
                  onChange={(id, name) =>
                    setForm((f) => ({ ...f, maHh: id, tenHh: name }))
                  }
                />
              </div>
              <div>
                <div className="text-xs text-slate-600 mb-0.5">Khu vực</div>
                <MasterPicker
                  type="KV"
                  value={form.makv}
                  displayName={form.tenKv}
                  placeholder="Tuỳ chọn…"
                  onChange={(id, name) =>
                    setForm((f) => ({ ...f, makv: id, tenKv: name }))
                  }
                />
              </div>
            </div>
            <label className="text-xs text-slate-600 block">
              Diễn giải
              <textarea
                value={form.dienGiai}
                onChange={(e) => setForm((f) => ({ ...f, dienGiai: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                rows={2}
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-300"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busy || !form.maNcc || !form.soTien}
                onClick={submitForm}
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
