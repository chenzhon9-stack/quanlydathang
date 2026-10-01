"use client";

import { useEffect, useState } from "react";

export type SendAction = "send" | "reset" | "cancel" | "markSent";

interface SendActionModalProps {
  open: boolean;
  message: string;
  isDuyenHa?: boolean;
  dayDiff?: number;
  onCancel: () => void;
  onConfirm: (action: SendAction) => void;
  loading?: boolean;
}

const OPTIONS: Array<{
  action: SendAction;
  label: string;
  description: string;
  icon: string;
  color: "primary" | "warning" | "danger" | "neutral";
}> = [
  {
    action: "send",
    label: "Gửi bình thường",
    description: "Gửi đơn tới NCC như bình thường (Email / Zalo / APP).",
    icon: "📤",
    color: "primary",
  },
  {
    action: "reset",
    label: "Reset đơn",
    description:
      "Tạo mã đơn mới, chuyển xe chưa nhận sang đơn mới (áp dụng mọi NCC).",
    icon: "🔄",
    color: "warning",
  },
  {
    action: "cancel",
    label: "Hủy đơn",
    description: "Hủy toàn bộ đơn. Không gửi NCC nếu đã quá hạn.",
    icon: "❌",
    color: "danger",
  },
  {
    action: "markSent",
    label: "Đánh dấu đã gửi ngoài hệ thống",
    description: "Đã xử lý/gửi NCC bằng cách khác (VD: gọi điện).",
    icon: "✓",
    color: "neutral",
  },
];

const COLOR_SELECTED: Record<string, string> = {
  primary: "bg-blue-600 border-blue-700 text-white",
  warning: "bg-amber-500 border-amber-600 text-white",
  danger: "bg-red-600 border-red-700 text-white",
  neutral: "bg-slate-200 border-slate-400 text-slate-900",
};

export function SendActionModal({
  open,
  message,
  isDuyenHa,
  dayDiff,
  onCancel,
  onConfirm,
  loading,
}: SendActionModalProps) {
  const [selected, setSelected] = useState<SendAction | null>("send");

  useEffect(() => {
    if (open) setSelected("send");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "1") setSelected("send");
      if (e.key === "2") setSelected("reset");
      if (e.key === "3") setSelected("cancel");
      if (e.key === "4") setSelected("markSent");
      if (e.key === "Enter" && selected) onConfirm(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, selected, onCancel, onConfirm]);

  if (!open) return null;

  // Reset áp dụng mọi NCC (parity canResetOrder / resetOrder)
  const visibleOptions = OPTIONS;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-800">
            Xác nhận gửi đơn muộn
          </h3>
          {isDuyenHa && (
            <p className="text-xs text-amber-600 mt-1">
              Duyên Hà — cửa sổ gửi đã trễ {dayDiff ?? "?"} ngày làm việc.
            </p>
          )}
        </div>

        <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">
            {message}
          </p>
        </div>

        <div className="px-5 py-3 space-y-2 max-h-[50vh] overflow-y-auto">
          {visibleOptions.map((opt) => {
            const isSelected = selected === opt.action;
            return (
              <button
                key={opt.action}
                type="button"
                disabled={loading}
                onClick={() => setSelected(opt.action)}
                className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all ${
                  isSelected
                    ? COLOR_SELECTED[opt.color]
                    : "bg-white hover:bg-slate-50 text-slate-800 border-slate-200"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg shrink-0" aria-hidden>
                    {opt.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{opt.label}</div>
                    <div
                      className={`text-xs mt-0.5 ${
                        isSelected ? "opacity-90" : "text-slate-500"
                      }`}
                    >
                      {opt.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
          >
            Đóng
          </button>
          <button
            type="button"
            disabled={!selected || loading}
            onClick={() => selected && onConfirm(selected)}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-white ${
              selected
                ? "bg-blue-600 hover:bg-blue-500"
                : "bg-slate-300 cursor-not-allowed"
            } disabled:opacity-60`}
          >
            {loading ? "Đang xử lý..." : "Xác nhận"}
          </button>
        </div>
      </div>
    </div>
  );
}
