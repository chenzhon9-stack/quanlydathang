"use client";

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700 border-slate-200",
  "Khởi tạo": "bg-slate-100 text-slate-700 border-slate-200",
  PROCESSING: "bg-amber-50 text-amber-700 border-amber-200",
  "Đang xử lý": "bg-amber-50 text-amber-700 border-amber-200",
  DONE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Hoàn thành": "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCEL: "bg-red-50 text-red-700 border-red-200",
  "Hủy đơn": "bg-red-50 text-red-700 border-red-200",
  ORDERED: "bg-blue-50 text-blue-700 border-blue-200",
  "Đặt hàng": "bg-blue-50 text-blue-700 border-blue-200",
  RECEIVED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Đã nhận": "bg-indigo-50 text-indigo-700 border-indigo-200",
  DELIVERING: "bg-violet-50 text-violet-700 border-violet-200",
  "Đang giao": "bg-violet-50 text-violet-700 border-violet-200",
  "Hủy xe": "bg-red-50 text-red-600 border-red-200",
  "Xóa xe": "bg-slate-100 text-slate-500 border-slate-200",
  "Đang thực hiện": "bg-sky-50 text-sky-700 border-sky-200",
  "Hoàn tất": "bg-emerald-50 text-emerald-700 border-emerald-200",
  Hủy: "bg-red-50 text-red-600 border-red-200",
};

export function StatusBadge({ status }: { status: string }) {
  const style =
    STATUS_STYLES[status] || "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      {status}
    </span>
  );
}
