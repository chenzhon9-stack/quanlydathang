/**
 * Màu trạng thái parity V21 (đậm, rõ — không nhạt như pastel 50).
 * Dùng cho badge + nền dòng bảng/card.
 */
export const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-amber-200 text-amber-950 border-amber-400",
  "Khởi tạo": "bg-amber-200 text-amber-950 border-amber-400",
  "Mới tạo": "bg-yellow-200 text-yellow-950 border-yellow-400",
  ORDERED: "bg-orange-200 text-orange-950 border-orange-400",
  "Đặt hàng": "bg-orange-200 text-orange-950 border-orange-400",
  PROCESSING: "bg-blue-200 text-blue-950 border-blue-400",
  "Đang xử lý": "bg-blue-200 text-blue-950 border-blue-400",
  RECEIVED: "bg-sky-200 text-sky-950 border-sky-400",
  "Đã nhận": "bg-sky-200 text-sky-950 border-sky-400",
  DELIVERING: "bg-teal-200 text-teal-950 border-teal-500",
  "Đang giao": "bg-teal-200 text-teal-950 border-teal-500",
  DONE: "bg-emerald-200 text-emerald-950 border-emerald-500",
  "Hoàn thành": "bg-emerald-200 text-emerald-950 border-emerald-500",
  CANCEL: "bg-slate-300 text-slate-800 border-slate-400",
  "Hủy": "bg-slate-300 text-slate-800 border-slate-400",
  "Hủy đơn": "bg-slate-300 text-slate-800 border-slate-400",
  "Hủy xe": "bg-slate-300 text-slate-800 border-slate-400",
  DELETE: "bg-red-200 text-red-900 border-red-400",
  "Xóa xe": "bg-red-200 text-red-900 border-red-400",
  ACTIVE: "bg-emerald-200 text-emerald-950 border-emerald-400",
  PENDING: "bg-amber-200 text-amber-950 border-amber-400",
  LOCKED: "bg-red-200 text-red-900 border-red-400",
};

/** Nền cả dòng (table / card) — V21 #FEF3C7, #FFEDD5, #DBEAFE… */
export const STATUS_ROW: Record<string, string> = {
  NEW: "bg-[#FEF3C7] text-[#92400E]",
  "Khởi tạo": "bg-[#FEF3C7] text-[#92400E]",
  "Mới tạo": "bg-[#FEF9C3] text-[#854D0E]",
  ORDERED: "bg-[#FFEDD5] text-[#9A3412]",
  "Đặt hàng": "bg-[#FFEDD5] text-[#9A3412]",
  PROCESSING: "bg-[#DBEAFE] text-[#1E40AF]",
  "Đang xử lý": "bg-[#DBEAFE] text-[#1E40AF]",
  RECEIVED: "bg-[#E0F2FE] text-[#075985]",
  "Đã nhận": "bg-[#E0F2FE] text-[#075985]",
  DELIVERING: "bg-[#CCFBF1] text-[#0F766E]",
  "Đang giao": "bg-[#CCFBF1] text-[#0F766E]",
  DONE: "bg-[#DCFCE7] text-[#166534]",
  "Hoàn thành": "bg-[#DCFCE7] text-[#166534]",
  CANCEL: "bg-[#E5E7EB] text-[#374151]",
  "Hủy": "bg-[#E5E7EB] text-[#374151]",
  "Hủy đơn": "bg-[#E5E7EB] text-[#374151]",
  "Hủy xe": "bg-[#E5E7EB] text-[#374151]",
  DELETE: "bg-[#FECACA] text-[#7F1D1D]",
  "Xóa xe": "bg-[#FECACA] text-[#7F1D1D]",
};

/** Chip filter trạng thái (đã chọn = đậm) */
export const STATUS_CHIP: Record<string, string> = {
  NEW: "bg-[#FEF3C7] text-[#92400E] border-[#F59E0B]",
  ORDERED: "bg-[#FFEDD5] text-[#9A3412] border-[#F97316]",
  PROCESSING: "bg-[#DBEAFE] text-[#1E40AF] border-[#3B82F6]",
  RECEIVED: "bg-[#E0F2FE] text-[#075985] border-[#0EA5E9]",
  DELIVERING: "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]",
  DONE: "bg-[#DCFCE7] text-[#166534] border-[#22C55E]",
  CANCEL: "bg-[#E5E7EB] text-[#374151] border-[#94A3B8]",
  ALL: "bg-slate-100 text-slate-700 border-slate-300",
};

export function statusRowClass(status: string): string {
  return STATUS_ROW[status] || "bg-white text-slate-800";
}

export function statusBadgeClass(status: string): string {
  return (
    STATUS_BADGE[status] ||
    "bg-slate-100 text-slate-700 border-slate-200"
  );
}

/** Biển số kiểu V21 plate-link */
export const PLATE_CLASS =
  "inline-block bg-[#facc15] text-black px-2 py-0.5 rounded font-black text-[12px] border-2 border-slate-800 shadow-[inset_1px_1px_1px_#fff,2px_2px_4px_rgba(0,0,0,.25)] tracking-wide";

/** Header nhóm ngày đặt lệnh */
export const SECTION_HEADER_CLASS =
  "bg-[#1a3a5c] text-white px-3 py-2 text-xs font-bold tracking-wide";
