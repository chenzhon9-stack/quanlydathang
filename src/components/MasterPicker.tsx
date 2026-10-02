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

/** Biển số hiển thị: BienSo / SoMooc (V21 _vehicleDisplayPlate_) */
function xeDisplayPlate(r: Record<string, string>, fallback = ""): string {
  const bien = String(r.BienSoXe || r.BienSo || "").trim();
  const mooc = String(r.SoMooc || "").trim();
  if (bien && mooc) return `${bien} / ${mooc}`;
  return bien || fallback;
}

/**
 * Nhãn xe trong danh sách (đủ chi tiết để chọn đúng).
 */
function formatXeLabel(r: Record<string, string>, id: string): string {
  const plate = xeDisplayPlate(r, id);
  const bits = [
    r.Tenlaixe,
    r.Dienthoai || r.DienThoai || r.Banglai,
    r.TenHTVT || r.MaHTVT,
    r.TenDVT || r.MaDVT,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return bits.length ? `${plate} | ${bits.join(" · ")}` : plate;
}

/** Nhãn đóng ô (V21): chỉ Biển / Mooc */
function formatXeClosed(r: Record<string, string>, id: string): string {
  return xeDisplayPlate(r, id);
}

/** KH đóng: Tên (hoặc Mã — Tên nếu trùng tên) */
function formatKhClosed(r: Record<string, string>, id: string): string {
  const ten = String(
    r.TenKhachhang || r.TenKhachHang || r.TenKH || ""
  ).trim();
  if (ten && ten !== id) return ten;
  return id;
}

/** HH đóng: Tên hàng (V21) */
function formatHhClosed(r: Record<string, string>, id: string): string {
  const ten = String(r.TenHangHoa || r.TenHH || "").trim();
  if (ten && ten !== id) return ten;
  return id;
}

/** Tên gửi lên onChange khi chọn (ô đóng gọn như V21) */
function closedNameFor(
  type: MasterType,
  id: string,
  listName: string,
  raw?: Record<string, string>
): string {
  if (!raw) return listName;
  if (type === "XE") return formatXeClosed(raw, id);
  if (type === "KH") return formatKhClosed(raw, id);
  if (type === "HH") return formatHhClosed(raw, id);
  if (type === "NCC") {
    const ten = String(raw.TenNCC || raw.TenNcc || "").trim();
    return ten && ten !== id ? ten : id;
  }
  return listName;
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
  /** Tên HTVT/ĐVT để hiển thị khóa trên form thêm xe (V21) */
  htvtName,
  dvtName,
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
  htvtName?: string;
  dvtName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState(displayName || value || "");
  const [loadedKey, setLoadedKey] = useState("");
  const [mounted, setMounted] = useState(false);
  /** Form thêm nhanh ĐVT / Xe */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickErr, setQuickErr] = useState<string | null>(null);
  // DVT fields (đủ như V21)
  const [qaTenDvt, setQaTenDvt] = useState("");
  const [qaPhone, setQaPhone] = useState("");
  const [qaMst, setQaMst] = useState("");
  const [qaDiaChi, setQaDiaChi] = useState("");
  const [qaLienHe, setQaLienHe] = useState("");
  const [qaGhiChu, setQaGhiChu] = useState("");
  // XE fields
  const [qaBienSo, setQaBienSo] = useState("");
  const [qaMooc, setQaMooc] = useState("");
  const [qaLaiXe, setQaLaiXe] = useState("");
  const [qaBangLai, setQaBangLai] = useState("");
  const [qaXeNote, setQaXeNote] = useState("");

  const canQuick = type === "DVT" || type === "XE";
  const isThueNgoai =
    !!htvtId &&
    (String(htvtId).toUpperCase() === "THUE_NGOAI" ||
      String(htvtId).toUpperCase().includes("THUE"));

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
          // Label đầy đủ V21: Biển/Mooc | Lái xe - SĐT - HTVT - ĐVT
          name = formatXeLabel(r, id);
        } else if (type === "KH") {
          // Hiện mã + tên để chọn đúng MaKh khi lập kế hoạch giao
          const ten = pickField(r, NAME_KEYS.KH) || id;
          name = ten !== id ? `${id} — ${ten}` : id;
        } else if (type === "HH" || type === "NCC") {
          const ten = pickField(r, NAME_KEYS[type]) || id;
          name = ten !== id ? `${id} — ${ten}` : id;
        }
        mapped.push({ id, name, raw: r });
      }
      // Sort khi mở picker: mã ASC, rồi tên (vi)
      mapped.sort((a, b) => {
        const byId = a.id.localeCompare(b.id, "vi", { numeric: true });
        if (byId !== 0) return byId;
        return a.name.localeCompare(b.name, "vi");
      });
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
        const r = it.raw || {};
        // Tìm trên mã + nhãn + toàn bộ field xe
        const hay = foldVn(
          [
            it.id,
            it.name,
            r.BienSoXe,
            r.BienSo,
            r.SoMooc,
            r.Tenlaixe,
            r.Banglai,
            r.Dienthoai,
            r.DienThoai,
            r.MaHTVT,
            r.TenHTVT,
            r.MaDVT,
            r.TenDVT,
            r.Ghichu,
          ]
            .filter(Boolean)
            .join(" ")
        );
        return parts.every((p) => hay.includes(p));
      })
      .slice(0, 150);
  }, [items, q]);

  function close() {
    setOpen(false);
    setQ("");
    setQuickOpen(false);
    setQuickErr(null);
  }

  async function openPicker() {
    if (disabled) return;
    setOpen(true);
    setQuickOpen(false);
    setQuickErr(null);
    await load();
  }

  function resetQuickForm() {
    setQaTenDvt("");
    setQaPhone("");
    setQaMst("");
    setQaDiaChi("");
    setQaLienHe("");
    setQaGhiChu("");
    setQaBienSo("");
    setQaMooc("");
    setQaLaiXe("");
    setQaBangLai("");
    setQaXeNote("");
    setQuickErr(null);
  }

  async function submitQuickAdd() {
    setQuickErr(null);
    setQuickBusy(true);
    try {
      const token = localStorage.getItem("token");
      let body: Record<string, unknown> = { type };
      if (type === "DVT") {
        if (!qaTenDvt.trim()) {
          setQuickErr("Vui lòng nhập tên đơn vị vận tải.");
          setQuickBusy(false);
          return;
        }
        body = {
          type: "DVT",
          tenDVT: qaTenDvt.trim(),
          dienThoai: qaPhone.trim(),
          mst: qaMst.trim(),
          diaChi: qaDiaChi.trim(),
          nguoiLienHe: qaLienHe.trim(),
          ghiChu: qaGhiChu.trim(),
        };
      } else if (type === "XE") {
        if (!qaBienSo.trim()) {
          setQuickErr("Vui lòng nhập biển số xe.");
          setQuickBusy(false);
          return;
        }
        if (!htvtId) {
          setQuickErr("Chọn hình thức vận tải trước khi thêm xe.");
          setQuickBusy(false);
          return;
        }
        if (isThueNgoai && !dvtId) {
          setQuickErr("Xe thuê ngoài — chọn đơn vị vận tải trước.");
          setQuickBusy(false);
          return;
        }
        body = {
          type: "XE",
          bienSo: qaBienSo.trim(),
          maHTVT: htvtId,
          maDVT: isThueNgoai ? dvtId || "" : "",
          soMooc: qaMooc.trim(),
          tenLaiXe: qaLaiXe.trim(),
          bangLai: qaBangLai.trim(),
          ghiChu: qaXeNote.trim(),
        };
      } else {
        setQuickBusy(false);
        return;
      }

      const res = await fetch("/api/v1/masters/quick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        // Trùng → có thể chọn item đã có
        if (json.error?.code === "DUPLICATE" && json.error?.item) {
          const it = json.error.item as {
            id: string;
            name: string;
            raw?: Record<string, string>;
          };
          if (confirm((json.error.message || "Trùng") + "\nChọn bản ghi đã có?")) {
            const closed = closedNameFor(type, it.id, it.name, it.raw);
            onChange(it.id, closed, it.raw);
            setLabel(closed);
            close();
          } else {
            setQuickErr(json.error.message || "Trùng");
          }
          return;
        }
        setQuickErr(json.error?.message || "Không thêm được");
        return;
      }
      const data = json.data as {
        id: string;
        name: string;
        raw?: Record<string, string>;
      };
      // Invalidate cache list + chọn item mới (ô đóng gọn như V21)
      setLoadedKey("");
      setItems([]);
      const closed = closedNameFor(type, data.id, data.name, data.raw);
      onChange(data.id, closed, data.raw);
      setLabel(closed);
      resetQuickForm();
      close();
    } catch (e: unknown) {
      setQuickErr((e as Error).message || "Lỗi mạng");
    } finally {
      setQuickBusy(false);
    }
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
          {/* Header — V21: list title hoặc form title */}
          <div className="bg-sky-500 text-white px-4 py-3 rounded-t-2xl sm:rounded-t-2xl flex items-center justify-between shrink-0">
            <h3 className="font-bold text-base">
              {quickOpen
                ? type === "DVT"
                  ? "Thêm đơn vị vận tải"
                  : "Thêm xe mới"
                : TYPE_TITLE[type]}
            </h3>
            <button
              type="button"
              onClick={() => {
                if (quickOpen) {
                  setQuickOpen(false);
                  resetQuickForm();
                } else close();
              }}
              className="text-white/90 hover:text-white text-xl leading-none px-1"
              aria-label="Đóng"
            >
              ×
            </button>
          </div>

          {/* ===== Form thêm nhanh (parity V21 modal) ===== */}
          {canQuick && quickOpen ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {type === "DVT" ? (
                <>
                  <div>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">
                      Tên đơn vị vận tải *
                    </div>
                    <input
                      autoFocus
                      value={qaTenDvt}
                      onChange={(e) => setQaTenDvt(e.target.value)}
                      placeholder="Nhập tên đơn vị vận tải"
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Điện thoại
                      </div>
                      <input
                        value={qaPhone}
                        onChange={(e) => setQaPhone(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Mã số thuế
                      </div>
                      <input
                        value={qaMst}
                        onChange={(e) => setQaMst(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">
                      Địa chỉ
                    </div>
                    <input
                      value={qaDiaChi}
                      onChange={(e) => setQaDiaChi(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">
                      Người liên hệ
                    </div>
                    <input
                      value={qaLienHe}
                      onChange={(e) => setQaLienHe(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">
                      Ghi chú
                    </div>
                    <textarea
                      value={qaGhiChu}
                      onChange={(e) => setQaGhiChu(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Xe: HTVT/ĐVT khóa theo ngữ cảnh form đơn (V21) */}
                  {!htvtId && (
                    <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Chọn <b>Hình thức vận tải</b> trên form đơn trước. Nếu{" "}
                      <b>Thuê ngoài</b> phải chọn thêm <b>Đơn vị vận tải</b>.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Biển số xe *
                      </div>
                      <input
                        autoFocus
                        value={qaBienSo}
                        onChange={(e) => setQaBienSo(e.target.value)}
                        placeholder="VD: 38C-12345"
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg uppercase"
                      />
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Số mooc
                      </div>
                      <input
                        value={qaMooc}
                        onChange={(e) => setQaMooc(e.target.value)}
                        placeholder="VD: 15R-… hoặc số mooc"
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Tên lái xe
                      </div>
                      <input
                        value={qaLaiXe}
                        onChange={(e) => setQaLaiXe(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Bằng lái
                      </div>
                      <input
                        value={qaBangLai}
                        onChange={(e) => setQaBangLai(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div
                    className={`grid gap-2 ${
                      isThueNgoai ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    <div>
                      <div className="text-[12px] font-semibold text-slate-600 mb-1">
                        Hình thức vận tải
                      </div>
                      <div className="px-3 py-2.5 text-sm rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                        {htvtName || htvtId || "— chưa chọn —"}
                      </div>
                    </div>
                    {isThueNgoai && (
                      <div>
                        <div className="text-[12px] font-semibold text-slate-600 mb-1">
                          Đơn vị vận tải
                        </div>
                        <div className="px-3 py-2.5 text-sm rounded-lg bg-slate-100 border border-slate-200 text-slate-700">
                          {dvtName || dvtId || "— chưa chọn —"}
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold text-slate-600 mb-1">
                      Ghi chú
                    </div>
                    <textarea
                      value={qaXeNote}
                      onChange={(e) => setQaXeNote(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none"
                    />
                  </div>
                </>
              )}
              {quickErr && (
                <p className="text-[12px] text-red-600 font-medium">{quickErr}</p>
              )}
              <button
                type="button"
                disabled={quickBusy}
                onClick={() => void submitQuickAdd()}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm disabled:opacity-50"
              >
                {quickBusy
                  ? "Đang lưu…"
                  : type === "DVT"
                    ? "LƯU VÀ CHỌN ĐƠN VỊ"
                    : "LƯU VÀ CHỌN XE"}
              </button>
            </div>
          ) : (
            <>
              {/* Search + nút thêm (V21: dưới ô tìm kiếm) */}
              <div className="p-3 border-b border-slate-100 shrink-0 space-y-2">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm kiếm…"
                  className="w-full px-3 py-2.5 text-base sm:text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                {canQuick && (
                  <button
                    type="button"
                    onClick={() => {
                      resetQuickForm();
                      setQuickOpen(true);
                    }}
                    className="w-full py-2.5 text-sm font-semibold rounded-xl bg-sky-500 text-white hover:bg-sky-400"
                  >
                    {type === "DVT"
                      ? "+ Thêm đơn vị vận tải mới"
                      : "+ Thêm xe mới"}
                  </button>
                )}
                <div className="text-[11px] text-slate-500">
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
                  filtered.map((it) => {
                    const r = it.raw || {};
                    const pick = () => {
                      const closed = closedNameFor(type, it.id, it.name, it.raw);
                      onChange(it.id, closed, it.raw);
                      setLabel(closed);
                      close();
                    };
                    if (type === "XE") {
                      const plate = xeDisplayPlate(r, it.id);
                      const laiXe = String(r.Tenlaixe || "").trim();
                      const phone = String(
                        r.Dienthoai || r.DienThoai || ""
                      ).trim();
                      const bangLai = String(r.Banglai || "").trim();
                      const htvt = String(r.TenHTVT || r.MaHTVT || "").trim();
                      const dvt = String(r.TenDVT || r.MaDVT || "").trim();
                      const mooc = String(r.SoMooc || "").trim();
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`w-full text-left px-4 py-3 border-b border-slate-100 active:bg-sky-50 hover:bg-sky-50 ${
                            it.id === value ? "bg-sky-50" : ""
                          }`}
                          onClick={pick}
                        >
                          {/* Dòng 1: Biển số / Mooc */}
                          <div
                            className={`text-sm sm:text-[15px] leading-snug ${
                              it.id === value
                                ? "font-semibold text-sky-800"
                                : "font-semibold text-slate-900"
                            }`}
                          >
                            {plate}
                          </div>
                          {/* Dòng 2: Lái xe · SĐT · Bằng lái */}
                          {(laiXe || phone || bangLai) && (
                            <div className="text-[12px] text-slate-700 mt-0.5 leading-snug">
                              {[laiXe, phone, bangLai]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                          {/* Dòng 3: HTVT · ĐVT */}
                          {(htvt || dvt) && (
                            <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                              {[htvt, dvt].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {/* Dòng 4: Mã xe + phụ */}
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5 break-all">
                            {it.id}
                            {mooc ? ` · Mooc ${mooc}` : ""}
                            {r.MaHTVT ? ` · ${r.MaHTVT}` : ""}
                            {r.MaDVT ? ` · ${r.MaDVT}` : ""}
                          </div>
                        </button>
                      );
                    }
                    // KH / HH / NCC: tên nổi, mã mono phía dưới
                    if (type === "KH" || type === "HH" || type === "NCC") {
                      const ten =
                        type === "KH"
                          ? formatKhClosed(r, it.id)
                          : type === "HH"
                            ? formatHhClosed(r, it.id)
                            : String(r.TenNCC || r.TenNcc || it.id).trim();
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`w-full text-left px-4 py-3 border-b border-slate-100 active:bg-sky-50 hover:bg-sky-50 ${
                            it.id === value ? "bg-sky-50" : ""
                          }`}
                          onClick={pick}
                        >
                          <div
                            className={`text-sm sm:text-[15px] leading-snug ${
                              it.id === value
                                ? "font-semibold text-sky-800"
                                : "font-semibold text-slate-900"
                            }`}
                          >
                            {ten}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5 break-all">
                            {it.id}
                          </div>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`w-full text-left px-4 py-3 border-b border-slate-50 active:bg-sky-50 hover:bg-sky-50 ${
                          it.id === value ? "bg-sky-50" : ""
                        }`}
                        onClick={pick}
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
                    );
                  })
                )}
              </div>

              <div className="p-3 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={close}
                  className="w-full py-2.5 text-sm font-medium rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </>
          )}
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
