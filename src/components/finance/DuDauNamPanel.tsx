"use client";

/**
 * Dư đầu năm & Chốt năm — parity V21 listDuDauNam / saveDuDauNam / voidDuDauNam
 */
import { useCallback, useEffect, useState } from "react";
import { MasterPicker } from "@/components/MasterPicker";
import { clientHasAny, readClientUser } from "@/lib/nav-access";

type Opening = {
  id: string;
  year: number;
  supplierId: string;
  openingAmount: number;
  note: string;
  closedBy: string;
  closedAt: string;
  active: boolean;
};

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString("vi-VN");
}

export function DuDauNamPanel() {
  const user = readClientUser();
  const canWrite = clientHasAny(user, ["PAYABLE_CREATE", "*"]);
  const canVoid = clientHasAny(user, ["PAYABLE_CANCEL", "*"]);

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [filterNcc, setFilterNcc] = useState("");
  const [filterNccName, setFilterNccName] = useState("");
  const [items, setItems] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [nameNcc, setNameNcc] = useState<Record<string, string>>({});

  const [formOpen, setFormOpen] = useState(false);
  const [chotOpen, setChotOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    maNcc: "",
    tenNcc: "",
    soDuDau: "",
    ghiChu: "",
    chot: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch("/api/v1/masters?type=NCC", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const out: Record<string, string> = {};
        for (const it of json?.data?.items || []) {
          if (it.id) out[it.id] = it.name || it.id;
        }
        setNameNcc(out);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    const token = localStorage.getItem("token") || "";
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams({
        year: year || String(new Date().getFullYear()),
      });
      const res = await fetch(`/api/v1/finance/opening?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải dư đầu năm");
        setItems([]);
        return;
      }
      let list = (json.data?.items || []) as Opening[];
      if (filterNcc) {
        list = list.filter((x) => x.supplierId === filterNcc);
      }
      setItems(list.filter((x) => x.active !== false));
    } catch {
      setErr("Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  }, [year, filterNcc]);

  async function submitForm() {
    setBusy(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/v1/finance/opening", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          year: Number(year) || new Date().getFullYear(),
          maNcc: form.maNcc,
          soDuDau: Number(String(form.soDuDau).replace(",", ".")),
          ghiChu: form.ghiChu,
          chot: form.chot,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Lưu thất bại");
        return;
      }
      setFormOpen(false);
      setChotOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function voidRow(id: string) {
    if (!confirm(`Hủy dòng dư đầu năm ${id}?`)) return;
    const token = localStorage.getItem("token") || "";
    const res = await fetch(
      `/api/v1/finance/opening/${encodeURIComponent(id)}/void`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ year: Number(year) }),
      }
    );
    const json = await res.json();
    if (!json.success) {
      alert(json.error?.message || "Hủy thất bại");
      return;
    }
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Năm
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Để trống = tất cả"
            className="mt-0.5 block w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 border border-slate-300"
        >
          ↻ Tải danh sách
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              onClick={() => {
                setForm({
                  maNcc: filterNcc,
                  tenNcc: filterNccName,
                  soDuDau: "",
                  ghiChu: "",
                  chot: false,
                });
                setFormOpen(true);
              }}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white"
            >
              + Thêm dư đầu năm
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({
                  maNcc: filterNcc,
                  tenNcc: filterNccName,
                  soDuDau: "",
                  ghiChu: "",
                  chot: true,
                });
                setChotOpen(true);
              }}
              className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 text-white"
            >
              📋 Chốt năm
            </button>
          </>
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
              <th className="px-3 py-2">Năm</th>
              <th className="px-3 py-2">NCC</th>
              <th className="px-3 py-2 text-right">Dư đầu năm</th>
              <th className="px-3 py-2">Ghi chú</th>
              <th className="px-3 py-2">Người chốt</th>
              <th className="px-3 py-2">Ngày chốt</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Đang tải…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Bấm tải danh sách để xem.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">{r.year}</td>
                  <td className="px-3 py-2">
                    {nameNcc[r.supplierId] || r.supplierId}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {fmtMoney(r.openingAmount)}
                  </td>
                  <td className="px-3 py-2">{r.note || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.closedBy || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.closedAt || "—"}</td>
                  <td className="px-3 py-2">
                    {r.closedBy ? (
                      <span className="text-xs text-amber-700 font-medium">Đã chốt</span>
                    ) : (
                      <span className="text-xs text-emerald-700">Hoạt động</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canVoid && (
                      <button
                        type="button"
                        onClick={() => voidRow(r.id)}
                        className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700"
                      >
                        Hủy
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(formOpen || chotOpen) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">
                {chotOpen ? "Chốt năm công nợ" : "Thêm dư đầu năm"}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setChotOpen(false);
                }}
              >
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
            <label className="text-xs text-slate-600 block">
              Số dư đầu năm *
              <input
                value={form.soDuDau}
                onChange={(e) =>
                  setForm((f) => ({ ...f, soDuDau: e.target.value }))
                }
                className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600 block">
              Ghi chú
              <input
                value={form.ghiChu}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ghiChu: e.target.value }))
                }
                className="mt-0.5 w-full rounded-lg border px-2 py-2 text-sm"
              />
            </label>
            {chotOpen && (
              <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded">
                Chốt năm sẽ ghi Người chốt / Ngày chốt trên dòng dư đầu năm.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 text-sm border rounded-lg"
                onClick={() => {
                  setFormOpen(false);
                  setChotOpen(false);
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busy || !form.maNcc}
                onClick={submitForm}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {busy ? "…" : chotOpen ? "Xác nhận chốt" : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
