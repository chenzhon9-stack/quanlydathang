import Link from "next/link";
import type { ReactNode } from "react";
import { statusBadgeClass } from "@/lib/status-styles";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${statusBadgeClass(
        status
      )}`}
    >
      {status}
    </span>
  );
}

/** Biển số xe — style V21 plate-link */
export function PlateBadge({ plate }: { plate?: string | null }) {
  if (!plate) return <span className="text-slate-400">—</span>;
  return <span className="inline-block bg-[#facc15] text-black px-2 py-0.5 rounded font-black text-[12px] border-2 border-slate-800 shadow-[inset_1px_1px_1px_#fff,2px_2px_4px_rgba(0,0,0,.25)] tracking-wide">{plate}</span>;
}

/**
 * Biển số bấm được: có file đơn → mở file đơn (tab mới);
 * chưa có file → giữ hành vi cũ (mở đơn trong /orders); không có gì → chỉ hiển thị.
 */
export function PlateLink({
  plate,
  orderFile,
  orderId,
  className,
  children,
}: {
  plate?: string | null;
  orderFile?: string | null;
  orderId?: string | null;
  className?: string;
  /** Thay PlateBadge mặc định (card mobile dùng PLATE_CLASS) */
  children?: ReactNode;
}) {
  const face = children ?? <PlateBadge plate={plate} />;
  if (orderFile) {
    return (
      <a
        href={orderFile}
        target="_blank"
        rel="noopener noreferrer"
        title="Mở file đơn hàng"
        className={className || "inline-flex hover:opacity-90"}
      >
        {face}
      </a>
    );
  }
  if (orderId) {
    return (
      <Link
        href={`/orders?q=${encodeURIComponent(orderId)}`}
        title="Mở đơn hàng"
        className={className || "inline-flex hover:opacity-90"}
      >
        {face}
      </Link>
    );
  }
  return <>{face}</>;
}
