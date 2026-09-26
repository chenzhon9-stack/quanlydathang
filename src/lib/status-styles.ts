/**
 * Màu trạng thái parity V21 (đậm, rõ).
 * Badge / nền card / chip filter.
 */

function foldStatus(raw: string): string {
  // Đ/đ không tách được bằng NFD → thay thủ công thành D/d
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

/** Map mọi biến thể → key chuẩn EN */
export function normalizeStatusKey(raw: string): string {
  const u = String(raw || "").trim().toUpperCase();
  const f = foldStatus(raw);
  if (u === "NEW" || f.includes("moi tao") || f.includes("khoi tao")) return "NEW";
  if (u === "ORDERED" || f.includes("dat hang")) return "ORDERED";
  if (u === "PROCESSING" || f.includes("dang xu ly")) return "PROCESSING";
  if (u === "RECEIVED" || f.includes("da nhan")) return "RECEIVED";
  if (u === "DELIVERING" || f.includes("dang giao")) return "DELIVERING";
  if (u === "DONE" || f.includes("hoan thanh")) return "DONE";
  if (u === "CANCEL" || f.includes("huy xe") || f === "huy" || f.includes("huy don"))
    return "CANCEL";
  if (u === "DELETE" || f.includes("xoa xe") || f === "xoa") return "DELETE";
  return u || f;
}

export const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-amber-200 text-amber-950 border-amber-400",
  ORDERED: "bg-orange-200 text-orange-950 border-orange-400",
  PROCESSING: "bg-blue-200 text-blue-950 border-blue-400",
  RECEIVED: "bg-sky-200 text-sky-950 border-sky-400",
  DELIVERING: "bg-teal-200 text-teal-950 border-teal-500",
  DONE: "bg-emerald-200 text-emerald-950 border-emerald-500",
  CANCEL: "bg-slate-300 text-slate-800 border-slate-400",
  DELETE: "bg-red-200 text-red-900 border-red-400",
};

/** Nền card/dòng — đúng palette V21 */
export const STATUS_ROW: Record<string, string> = {
  NEW: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  ORDERED: "bg-[#FFEDD5] text-[#9A3412] border-[#FED7AA]",
  PROCESSING: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  RECEIVED: "bg-[#E0F2FE] text-[#075985] border-[#BAE6FD]",
  DELIVERING: "bg-[#CCFBF1] text-[#0F766E] border-[#99F6E4]",
  DONE: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  CANCEL: "bg-[#E5E7EB] text-[#374151] border-[#D1D5DB]",
  DELETE: "bg-[#FECACA] text-[#7F1D1D] border-[#FECACA]",
};

/** Chip filter — key VN + EN */
export const STATUS_CHIP: Record<string, string> = {
  ALL: "bg-sky-600 text-white border-sky-700",
  NEW: "bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]",
  "Mới tạo": "bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]",
  ORDERED: "bg-[#FFEDD5] text-[#9A3412] border-[#F97316]",
  "Đặt hàng": "bg-[#FFEDD5] text-[#9A3412] border-[#F97316]",
  PROCESSING: "bg-[#DBEAFE] text-[#1E40AF] border-[#3B82F6]",
  RECEIVED: "bg-[#E0F2FE] text-[#075985] border-[#0EA5E9]",
  "Đã nhận": "bg-[#E0F2FE] text-[#075985] border-[#0EA5E9]",
  DELIVERING: "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]",
  "Đang giao": "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]",
  DONE: "bg-[#DCFCE7] text-[#166534] border-[#22C55E]",
  "Hoàn thành": "bg-[#DCFCE7] text-[#166534] border-[#22C55E]",
  CANCEL: "bg-[#E5E7EB] text-[#374151] border-[#94A3B8]",
  "Hủy xe": "bg-[#E5E7EB] text-[#374151] border-[#94A3B8]",
  DELETE: "bg-[#FECACA] text-[#7F1D1D] border-[#F87171]",
  "Xóa xe": "bg-[#FECACA] text-[#7F1D1D] border-[#F87171]",
};

export function statusRowClass(status: string): string {
  const k = normalizeStatusKey(status);
  return STATUS_ROW[k] || "bg-white text-slate-800 border-slate-200";
}

export function statusBadgeClass(status: string): string {
  const k = normalizeStatusKey(status);
  return (
    STATUS_BADGE[k] || "bg-slate-100 text-slate-700 border-slate-200"
  );
}

export function statusChipClass(status: string): string {
  if (STATUS_CHIP[status]) return STATUS_CHIP[status];
  const k = normalizeStatusKey(status);
  return STATUS_CHIP[k] || "bg-slate-50 text-slate-700 border-slate-300";
}

/** Biển số kiểu V21 */
export const PLATE_CLASS =
  "inline-block bg-[#facc15] text-black px-2.5 py-0.5 rounded font-black text-[12px] border-2 border-slate-800 shadow-[inset_1px_1px_1px_#fff,2px_2px_4px_rgba(0,0,0,.25)] tracking-wide";

export const DATE_GROUP_HEADER =
  "sticky top-0 z-10 rounded-xl bg-[#1a3a5c] text-white px-3.5 py-2.5 text-sm font-semibold shadow-md";


/** Lọc chip trạng thái: so khớp EN/VN qua normalizeStatusKey */
export function matchStatusFilter(
  rowStatus: string | undefined | null,
  selected: string[]
): boolean {
  if (!selected.length || selected.includes("ALL")) return true;
  const rowKey = normalizeStatusKey(String(rowStatus || ""));
  return selected.some((sel) => {
    if (sel === "ALL") return true;
    return normalizeStatusKey(sel) === rowKey;
  });
}
