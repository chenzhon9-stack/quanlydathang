import Link from "next/link";
import type { ReactNode } from "react";
import { statusBadgeClass } from "@/lib/status-styles";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border tracking-tight ${statusBadgeClass(
        status
      )}`}
    >
      {status}
    </span>
  );
}

/** Biển số xe — style V21 plate */
export function PlateBadge({
  plate,
  interactive,
}: {
  plate?: string | null;
  /** Có file đơn: hover sáng / phóng nhẹ / ring */
  interactive?: boolean;
}) {
  if (!plate) return <span className="text-slate-400">—</span>;
  const base =
    "inline-block bg-[#facc15] text-black px-2 py-0.5 rounded font-black text-[12px] border-2 border-slate-800 shadow-[inset_1px_1px_1px_#fff,2px_2px_4px_rgba(0,0,0,.25)] tracking-wide leading-none";
  const hover = interactive
    ? " transition duration-150 ease-out group-hover:brightness-110 group-hover:scale-105 group-hover:shadow-md group-hover:ring-2 group-hover:ring-amber-400 group-hover:border-amber-700"
    : "";
  return <span className={base + hover}>{plate}</span>;
}

/**
 * Biển số bấm được: có file đơn → mở file (tab mới) + hover nổi;
 * chưa có file → mở đơn trong /orders; không có gì → chỉ hiển thị.
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
  children?: ReactNode;
}) {
  const hasFile = !!orderFile;
  const face =
    children ?? <PlateBadge plate={plate} interactive={hasFile} />;

  if (orderFile) {
    return (
      <a
        href={orderFile}
        target="_blank"
        rel="noopener noreferrer"
        title="Mở file đơn hàng"
        className={
          (className || "inline-flex") +
          " group relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        }
      >
        {/* children (mobile PLATE_CLASS) cũng nhận hover qua group */}
        <span
          className={
            children
              ? "inline-flex transition duration-150 group-hover:brightness-110 group-hover:scale-105 group-hover:ring-2 group-hover:ring-amber-400 rounded"
              : "inline-flex"
          }
        >
          {face}
        </span>
        <span
          className="pointer-events-none absolute -top-7 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white shadow group-hover:block"
          role="tooltip"
        >
          Mở file đơn
        </span>
      </a>
    );
  }
  if (orderId) {
    return (
      <Link
        href={`/orders?q=${encodeURIComponent(orderId)}`}
        title="Mở đơn hàng"
        className={(className || "inline-flex") + " hover:opacity-90"}
      >
        {face}
      </Link>
    );
  }
  return <>{face}</>;
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
