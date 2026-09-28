"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { foldVn } from "@/lib/vn-search";

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

const TYPE_TITLE: Record<MasterType, string> = {
  KH: "Chọn khách hàng",
  HH: "Chọn hàng hóa",
  KV: "Chọn khu vực",
  XE: "Chọn xe",
  NCC: "Chọn nhà cung cấp",
  HTVT: "Chọn hình thức vận tải",
  DVT: "Chọn đơn vị vận tải",
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

/**
 * Picker danh mục — panel chọn dạng modal giữa màn hình (mobile-friendly, parity V21).
 * - type=HH + supplierId → chỉ HH có trong NCC_Hanghoa của NCC đó
 * - allowedIds → whitelist mã
 * - XE lọc theo htvtId / dvtId
 */
export function MasterPicker({
  type,
  value,
  displayName,
  onChange,
  placeholder,
  disabled,
  supplierId,
  allowedIds,
  htvtId,
  dvtId,
}: {
  type: MasterType;
  value: string;
  displayName?: string;
  onChange: (id: string, name: string, raw?: Record<string, string>) => void;
  placeholder?: string;
  disabled?: boolean;
  supplierId?: string;
  allowedIds?: string[];
  htvtId?: string;
  dvtId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState(displayName || value || "");
  const [loadedKey, setLoadedKey] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLabel(displayName || value || "");
  }, [displayName, value]);

  useEffect(() => {
    setItems([]);
    setLoadedKey("");
  }, [type, supplierId, htvtId, dvtId]);

  // Khóa scroll body khi mở modal
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC đóng
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQ("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function load() {
    const cacheKey = `${type}|${supplierId || ""}|${htvtId || ""}|${dvtId || ""}`;
    if (items.length && loadedKey === cacheKey) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const headers = { Authorization: `Bearer ${token}` };

      let allowSet: Set<string> | null = allowedIds
        ? new Set(allowedIds.map((x) => x.trim()))
        : null;

      if (type === "HH" && supplierId) {
        const resLink = await fetch(`/api/v1/masters?type=NCC_HH`, { headers });
        const jsonLink = await resLink.json();
        const links: Record<string, string>[] = jsonLink.data?.items || [];
        const ncc = String(supplierId).trim().toLowerCase();
        const hhIds = new Set<string>();
        for (const r of links) {
          if (r.HoatDong !== undefined && !isActive(r.HoatDong)) continue;
          const maNcc = String(r.MaNCC || r.MaNcc || "")
            .trim()
            .toLowerCase();
          const maHh = String(r.MaHH || r.MaHh || "").trim();
          if (maNcc === ncc && maHh) hhIds.add(maHh);
        }
        allowSet = hhIds;
      }

      const res = await fetch(`/api/v1/masters?type=${type}`, { headers });
      const json = await res.json();
      const rows: Record<string, string>[] = json.data?.items || [];
      const mapped: Item[] = [];
      for (const r of rows) {
        if (r.HoatDong !== undefined && !isActive(r.HoatDong)) continue;
        const id = pickField(r, ID_KEYS[type]);
        if (!id) continue;
        if (allowSet && !allowSet.has(id)) continue;
        if (type === "XE") {
          if (htvtId) {
            const xH = String(r.MaHTVT || "").trim();
            if (xH && xH !== htvtId) continue;
          }
          if (dvtId) {
            const xD = String(r.MaDVT || "").trim();
            if (xD && xD !== dvtId) continue;
            if (!xD) continue;
          }
        }
        let name = pickField(r, NAME_KEYS[type]) || id;
        if (type === "XE") {
          const plate = String(r.BienSoXe || r.BienSo || name).trim();
          const sub = [r.Tenlaixe, r.TenHTVT, r.TenDVT]
            .filter(Boolean)
            .join(" - ");
          name = sub ? `${plate} | ${sub}` : plate;
        }
        mapped.push({ id, name, raw: r });
      }
      mapped.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      setItems(mapped);
      setLoadedKey(cacheKey);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const s = foldVn(q);
    if (!s) return items.slice(0, 150);
    const parts = s.split(/\s+/).filter(Boolean);
    return items
      .filter((it) => {
        const hay = foldVn(`${it.id} ${it.name}`);
        return parts.every((p) => hay.includes(p));
      })
      .slice(0, 150);
  }, [items, q]);

  function close() {
    setOpen(false);
    setQ("");
  }

  async function openPicker() {
    if (disabled) return;
    setOpen(true);
    await load();
  }

  const modal =
    open &&
    !disabled &&
    mounted &&
    createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={TYPE_TITLE[type]}
      >
        {/* Panel: mobile gần full-height từ dưới; desktop card giữa */}
        <div
          className="
            w-full sm:max-w-md
            bg-white shadow-2xl
            rounded-t-2xl sm:rounded-2xl
            flex flex-col
            max-h-[88vh] sm:max-h-[80vh]
            animate-in fade-in
          "
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header giống V21 */}
          <div className="bg-sky-500 text-white px-4 py-3 rounded-t-2xl sm:rounded-t-2xl flex items-center justify-between shrink-0">
            <h3 className="font-bold text-base">{TYPE_TITLE[type]}</h3>
            <button
              type="button"
              onClick={close}
              className="text-white/90 hover:text-white text-xl leading-none px-1"
              aria-label="Đóng"
            >
              ×
            </button>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-slate-100 shrink-0">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm mã / tên (không dấu)…"
              className="w-full px-3 py-2.5 text-base sm:text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <div className="mt-1.5 text-[11px] text-slate-500">
              {loading
                ? "Đang tải…"
                : `${filtered.length}${items.length > filtered.length ? ` / ${items.length}` : ""} mục`}
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1 overscroll-contain">
            {loading ? (
              <div className="text-center text-slate-400 text-sm py-10">
                Đang tải danh mục…
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-10 px-4">
                {type === "HH" && supplierId
                  ? "Không có HH trong NCC_Hanghoa của NCC này"
                  : q
                    ? "Không tìm thấy kết quả"
                    : "Không có dữ liệu"}
              </div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 active:bg-sky-50 hover:bg-sky-50 ${
                    it.id === value ? "bg-sky-50" : ""
                  }`}
                  onClick={() => {
                    onChange(it.id, it.name, it.raw);
                    setLabel(it.name);
                    close();
                  }}
                >
                  <div
                    className={`text-sm sm:text-[15px] leading-snug ${
                      it.id === value
                        ? "font-semibold text-sky-800"
                        : "font-medium text-slate-800"
                    }`}
                  >
                    {it.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {it.id}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-slate-100 shrink-0 safe-area-pb">
            <button
              type="button"
              onClick={close}
              className="w-full py-2.5 text-sm font-medium rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <div className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`w-full text-left px-3 py-2 rounded-lg text-sm border whitespace-normal break-words leading-snug min-h-[40px] ${
          disabled
            ? "bg-slate-100 border-slate-200 text-slate-600"
            : "bg-white border-slate-300 hover:border-sky-400"
        }`}
      >
        <span className="block whitespace-normal break-words">
          {label || (
            <span className="text-slate-400">
              {placeholder ||
                (type === "HH" && supplierId
                  ? "Chọn hàng theo NCC…"
                  : `Chọn ${type}…`)}
            </span>
          )}
        </span>
      </button>
      {modal}
    </div>
  );
}
