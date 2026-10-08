"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { matchSearchVn } from "@/lib/vn-search";

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

type FieldDef = {
  type: string;
  required?: boolean;
  readonly?: boolean;
  label?: string;
  placeholder?: string;
  step?: string;
  options?: string[];
  pickerType?: string;
};

type Schema = {
  type: string;
  key: string;
  active: string | null;
  nameField: string | null;
  displayFields: string[];
  requiredFields: string[];
  fieldTypes: Record<string, FieldDef>;
  headerLabels: Record<string, string>;
  canSoftDelete: boolean;
};

function token() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function isActiveVal(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const t = String(v ?? "").toLowerCase();
  if (["false", "0", "no", "không", "khoa", "khóa"].includes(t)) return false;
  return true;
}

export default function MastersPage() {
  const [type, setType] = useState<(typeof TYPES)[number]["key"]>("NCC");
  const [schema, setSchema] = useState<Schema | null>(null);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [formErr, setFormErr] = useState("");

  // picker options for HTVT/DVT/NCC/HH
  const [pickMaps, setPickMaps] = useState<
    Record<string, { id: string; label: string }[]>
  >({});

  const load = useCallback(async (t: string) => {
    const tok = token();
    if (!tok) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/v1/masters?type=${t}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải danh mục");
        setItems([]);
        setSchema(null);
        return;
      }
      setSchema(json.data.schema || null);
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

  useEffect(() => {
    // Quyền ghi: admin / MASTER_UPDATE từ /me
    (async () => {
      try {
        const res = await fetch("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const json = await res.json();
        if (!json.success) return;
        const u = json.data?.user || json.data || {};
        const role = String(u.role || "").toUpperCase();
        const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
        setCanWrite(
          role === "ADMIN" ||
            perms.includes("*") ||
            perms.includes("MASTER_UPDATE")
        );
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadPickers = useCallback(async () => {
    const need = ["HTVT", "DVT", "NCC", "HH"];
    const out: Record<string, { id: string; label: string }[]> = {};
    for (const t of need) {
      try {
        const res = await fetch(`/api/v1/masters?type=${t}`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const json = await res.json();
        if (!json.success) continue;
        const sch = json.data.schema as Schema | undefined;
        const key = sch?.key || "id";
        const nameF = sch?.nameField || key;
        out[t] = (json.data.items || []).map(
          (r: Record<string, unknown>) => ({
            id: String(r[key] ?? ""),
            label: `${r[key] || ""} — ${r[nameF] || ""}`.trim(),
          })
        );
      } catch {
        /* ignore */
      }
    }
    setPickMaps(out);
  }, []);

  const openCreate = async () => {
    setEditing(null);
    setFormErr("");
    const init: Record<string, unknown> = {};
    if (schema?.fieldTypes) {
      Object.entries(schema.fieldTypes).forEach(([k, def]) => {
        if (def.type === "checkbox") init[k] = true;
        else init[k] = "";
      });
    }
    setForm(init);
    await loadPickers();
    setModalOpen(true);
  };

  const openEdit = async (row: Record<string, unknown>) => {
    setEditing(row);
    setFormErr("");
    setForm({ ...row });
    await loadPickers();
    setModalOpen(true);
  };

  const saveForm = async () => {
    if (!schema) return;
    setBusy(true);
    setFormErr("");
    try {
      const body = {
        type,
        row: { ...form },
      };
      // ensure key on edit
      if (editing && schema.key) {
        body.row[schema.key] = editing[schema.key];
      }
      const res = await fetch("/api/v1/masters", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setFormErr(json.error?.message || "Lưu thất bại");
        return;
      }
      setModalOpen(false);
      await load(type);
    } catch {
      setFormErr("Lỗi mạng");
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = async (row: Record<string, unknown>) => {
    if (!schema?.key || !canWrite) return;
    const key = encodeURIComponent(String(row[schema.key] ?? ""));
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/masters/${type}/${key}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "toggle" }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Không đổi được trạng thái");
        return;
      }
      await load(type);
    } finally {
      setBusy(false);
    }
  };

  const softDelete = async (row: Record<string, unknown>) => {
    if (!schema?.key || !schema.canSoftDelete || !canWrite) return;
    const id = String(row[schema.key] ?? "");
    if (!confirm(`Ngưng hoạt động «${id}»?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/masters/${type}/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token()}` },
        }
      );
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Không xóa được");
        return;
      }
      await load(type);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return items;
    return items.filter((row) => {
      const hay = Object.values(row)
        .map((v) => String(v ?? ""))
        .join(" ");
      return matchSearchVn(hay, q);
    });
  }, [items, q]);

  const displayCols = schema?.displayFields?.length
    ? schema.displayFields
    : Object.keys(items[0] || {}).slice(0, 8);

  const labelOf = (h: string) => schema?.headerLabels?.[h] || h;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Danh mục</h2>
          <p className="text-xs text-slate-500">
            Master data · parity V21 (CRUD Admin / MASTER_UPDATE)
            {err && <span className="text-red-600"> · {err}</span>}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            + Thêm mới
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
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

      <div className="flex gap-2 items-center flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm (Và/Hoặc ;)  trong danh mục…"
          className="flex-1 min-w-[12rem] max-w-sm px-3 py-2 text-sm border border-slate-200 rounded-lg"
        />
        <button
          type="button"
          onClick={() => load(type)}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
        <span className="text-xs text-slate-400">
          {filtered.length} dòng
          {!canWrite && " · chỉ xem"}
        </span>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-10 text-sm">Đang tải…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Scroll ngang; cột mã (đầu) + thao tác (cuối) sticky không bị khuất */}
          <div className="overflow-x-auto max-w-full">
          <table className="text-sm border-collapse" style={{ minWidth: canWrite ? 720 : 560 }}>
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                {displayCols.map((h, colIdx) => {
                  const isKey = schema?.key === h || colIdx === 0;
                  return (
                    <th
                      key={h}
                      className={
                        "px-3 py-2.5 text-left font-semibold whitespace-nowrap " +
                        (isKey
                          ? "sticky left-0 z-20 bg-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] min-w-[7.5rem]"
                          : "min-w-[6rem]")
                      }
                    >
                      {labelOf(h)}
                    </th>
                  );
                })}
                {canWrite && (
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap sticky right-0 z-20 bg-slate-100 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.12)] min-w-[9.5rem]">
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((row, i) => {
                const activeCol = schema?.active;
                const active = activeCol
                  ? isActiveVal(row[activeCol])
                  : true;
                const rowBg = !active ? "bg-slate-50" : "bg-white";
                return (
                  <tr
                    key={i}
                    className={`border-t border-slate-100 hover:bg-slate-50 ${
                      !active ? "opacity-60" : ""
                    }`}
                  >
                    {displayCols.map((h, colIdx) => {
                      const isKey = schema?.key === h || colIdx === 0;
                      const raw = String(row[h] ?? "");
                      const display =
                        schema?.fieldTypes?.[h]?.type === "checkbox"
                          ? isActiveVal(row[h])
                            ? "✓"
                            : "—"
                          : raw;
                      return (
                        <td
                          key={h}
                          className={
                            "px-3 py-2 text-slate-700 " +
                            (isKey
                              ? `sticky left-0 z-10 ${rowBg} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] font-medium whitespace-nowrap min-w-[7.5rem]`
                              : "whitespace-nowrap max-w-[12rem] truncate")
                          }
                          title={raw}
                        >
                          {display}
                        </td>
                      );
                    })}
                    {canWrite && (
                      <td
                        className={`px-2 py-2 text-right whitespace-nowrap sticky right-0 z-10 ${rowBg} shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]`}
                      >
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openEdit(row)}
                            className="px-2 py-1 text-[11px] rounded border border-slate-300 bg-white"
                          >
                            Sửa
                          </button>
                          {schema?.active && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => toggleRow(row)}
                              className="px-2 py-1 text-[11px] rounded border border-amber-300 bg-amber-50 text-amber-800"
                            >
                              {active ? "Tắt" : "Bật"}
                            </button>
                          )}
                          {schema?.canSoftDelete && active && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => softDelete(row)}
                              className="px-2 py-1 text-[11px] rounded border border-red-200 bg-red-50 text-red-700"
                            >
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {filtered.length > 300 && (
            <div className="text-xs text-slate-400 px-3 py-2 border-t">
              Hiển thị 300 / {filtered.length} — thu hẹp bằng ô tìm kiếm
            </div>
          )}
          {!filtered.length && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Không có dữ liệu
            </div>
          )}
        </div>
      )}

      {/* Modal form */}
      {modalOpen && schema && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 className="font-semibold text-slate-800">
                {editing ? "Sửa danh mục" : "Thêm danh mục"} · {type}
              </h3>
              <button
                type="button"
                className="text-slate-500 text-sm"
                onClick={() => setModalOpen(false)}
              >
                Đóng
              </button>
            </div>
            <div className="p-4 space-y-3">
              {formErr && (
                <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
                  {formErr}
                </div>
              )}
              {Object.entries(schema.fieldTypes).map(([field, def]) => {
                const label = def.label || schema.headerLabels[field] || field;
                const readOnly =
                  !!def.readonly && (!!editing || field === schema.key);
                // create: key auto-generated → hide or readonly empty
                if (!editing && def.readonly) {
                  return (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {label}{" "}
                        <span className="text-slate-400 font-normal">
                          (tự sinh nếu để trống)
                        </span>
                      </label>
                      <input
                        className="w-full px-3 py-2 text-sm border rounded-lg bg-slate-50"
                        value={String(form[field] ?? "")}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field]: e.target.value }))
                        }
                        placeholder="Để trống = hệ thống sinh mã"
                      />
                    </div>
                  );
                }

                if (def.type === "checkbox") {
                  return (
                    <label
                      key={field}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={isActiveVal(form[field])}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [field]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  );
                }

                if (def.type === "select" && def.options) {
                  return (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {label}
                        {def.required ? " *" : ""}
                      </label>
                      <select
                        className="w-full px-3 py-2 text-sm border rounded-lg"
                        value={String(form[field] ?? "")}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field]: e.target.value }))
                        }
                      >
                        <option value="">— Chọn —</option>
                        {def.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (def.type === "picker" && def.pickerType) {
                  const opts = pickMaps[def.pickerType] || [];
                  return (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {label}
                        {def.required ? " *" : ""}
                      </label>
                      <select
                        className="w-full px-3 py-2 text-sm border rounded-lg"
                        value={String(form[field] ?? "")}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field]: e.target.value }))
                        }
                      >
                        <option value="">— Chọn —</option>
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (def.type === "textarea") {
                  return (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {label}
                      </label>
                      <textarea
                        className="w-full px-3 py-2 text-sm border rounded-lg min-h-[4rem]"
                        value={String(form[field] ?? "")}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field]: e.target.value }))
                        }
                      />
                    </div>
                  );
                }

                return (
                  <div key={field}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {label}
                      {def.required ? " *" : ""}
                    </label>
                    <input
                      type={def.type === "number" ? "number" : "text"}
                      step={def.step}
                      disabled={readOnly}
                      placeholder={def.placeholder}
                      className={`w-full px-3 py-2 text-sm border rounded-lg ${
                        readOnly ? "bg-slate-50" : ""
                      }`}
                      value={String(form[field] ?? "")}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          [field]:
                            def.type === "number"
                              ? e.target.value
                              : e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t flex justify-end gap-2 sticky bottom-0 bg-slate-50">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-lg border"
                onClick={() => setModalOpen(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={busy}
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
