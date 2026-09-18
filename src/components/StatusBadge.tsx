"use client";

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-amber-100 text-amber-800 border-amber-200",
  "Khởi tạo": "bg-amber-100 text-amber-800 border-amber-200",
  PROCESSING: "bg-sky-100 text-sky-800 border-sky-200",
  "Đang xử lý": "bg-sky-100 text-sky-800 border-sky-200",
  DONE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Hoàn thành": "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCEL: "bg-red-100 text-red-700 border-red-200",
  "Hủy đơn": "bg-red-100 text-red-700 border-red-200",
  ORDERED: "bg-blue-100 text-blue-800 border-blue-200",
  "Đặt hàng": "bg-blue-100 text-blue-800 border-blue-200",
  RECEIVED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Đã nhận": "bg-indigo-100 text-indigo-800 border-indigo-200",
  DELIVERING: "bg-violet-100 text-violet-800 border-violet-200",
  "Đang giao": "bg-violet-100 text-violet-800 border-violet-200",
  "Đang thực hiện": "bg-sky-100 text-sky-800 border-sky-200",
  "Hoàn tất": "bg-emerald-100 text-emerald-800 border-emerald-200",
  Hủy: "bg-red-100 text-red-700 border-red-200",
};

export function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${style}`}
    >
      {status}
    </span>
  );
}
