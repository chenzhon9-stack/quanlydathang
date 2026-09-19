"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sub-tabs theo V21 + Permission Matrix skill */
const SUB_TABS = [
  { href: "/reports/receiving", key: "thuc_nhan", label: "Thực nhận" },
  { href: "/reports/thuc-giao", key: "thuc_giao", label: "Thực giao" },
  { href: "/reports/giao-nhan", key: "giao_nhan", label: "Giao nhận" },
  { href: "/reports/doi-chieu", key: "doi_chieu", label: "Đối chiếu N-G" },
  { href: "/reports/van-tai", key: "van_tai", label: "Vận tải thuê ngoài" },
  { href: "/reports/vong-doi", key: "vong_doi", label: "Vòng đời đơn" },
];

export function ReportSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
      {SUB_TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              active
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
