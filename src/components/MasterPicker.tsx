"use client";

import React, { useEffect, useMemo, useState } from "react";

export type MasterType = "KH" | "HH" | "KV" | "XE" | "NCC" | "HTVT" | "DVT";

type Item = { id: string; name: string; raw?: Record<string, string> };

const ID_KEYS: Record<MasterType, string[]> = {
  KH: ["MaKh", "MaKH", "MaKhach"],
  HH: ["MaHH", "MaHh"],
  KV: ["Makv", "MaKV"],
  XE: ["MaXe"],
  NCC: ["MaNCC", "MaNcc"],
  HTVT: ["MaHTVT"],
  DVT: ["MaDVT"],
};

const NAME_KEYS: Record<MasterType, string[]> = {
  KH: ["TenKhachhang", "TenKhachHang", "TenKH"],
  HH: ["TenHangHoa", "TenHH"],
  KV: ["Khuvuc", "TenKV"],
  XE: ["BienSoXe", "BienSo"],
  NCC: ["TenNCC", "TenNcc"],
  HTVT: ["TenHTVT"],
  DVT: ["TenDVT"],
};

function pickField(row: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    if (row[k]) return String(row[k]).trim();
  }
  return "";
}

function isActive(v: unknown) {
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase();
  return !["false", "0", "no", "không", "khoa", "khóa"].includes(s);
}

export function MasterPicker({
  type,
  value,
  displayName,
  onChange,
  placeholder,
  disabled,
}: {
  type: MasterType;
  value: string;
  displayName?: string;
  onChange: (id: string, name: string, raw?: Record<string, string>) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState(displayName || value || "");

  useEffect(() => {
    setLabel(displayName || value || "");
  }, [displayName, value]);

  async function load() {
    if (items.length) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/v1/masters?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const rows: Record<string, string>[] = json.data?.items || [];
      const mapped: Item[] = [];
      for (const r of rows) {
        if (r.HoatDong !== undefined && !isActive(r.HoatDong) && type !== "KV")
          continue;
        const id = pickField(r, ID_KEYS[type]);
        if (!id) continue;
        const name = pickField(r, NAME_KEYS[type]) || id;
        mapped.push({ id, name, raw: r });
      }
      mapped.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      setItems(mapped);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.slice(0, 80);
    return items
      .filter(
        (it) =>
          it.id.toLowerCase().includes(s) ||
          it.name.toLowerCase().includes(s)
      )
      .slice(0, 80);
  }, [items, q]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={async () => {
          if (disabled) return;
          setOpen((o) => !o);
          if (!open) await load();
        }}
        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm border ${
          disabled
            ? "bg-slate-100 border-slate-200 text-slate-600"
            : "bg-white border-slate-300 hover:border-sky-400"
        }`}
      >
        {label || (
          <span className="text-slate-400">
            {placeholder || `Chọn ${type}…`}
          </span>
        )}
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 flex flex-col">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm mã / tên…"
            className="m-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="text-center text-slate-400 text-xs py-4">
                Đang tải…
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-4">
                Không có dữ liệu
              </div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 border-t border-slate-50 ${
                    it.id === value ? "bg-sky-50 font-semibold" : ""
                  }`}
                  onClick={() => {
                    onChange(it.id, it.name, it.raw);
                    setLabel(`${it.name}`);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <div className="font-medium text-slate-800">{it.name}</div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {it.id}
                  </div>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            className="text-xs text-slate-500 py-2 border-t"
            onClick={() => setOpen(false)}
          >
            Đóng
          </button>
        </div>
      )}
    </div>
  );
}
