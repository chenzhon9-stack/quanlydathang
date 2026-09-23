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
