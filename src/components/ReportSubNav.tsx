"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Sub-tabs báo cáo — V21 index ROLE_REPORT_TABS
 * admin/manager/purchase/dispatcher: full
 * sales/viewer/accountant: thuc_giao + van_tai only
 */
const ALL_TABS = [
  { href: "/reports/receiving", key: "thuc_nhan", label: "Thực nhận" },
  { href: "/reports/thuc-giao", key: "thuc_giao", label: "Thực giao" },
  { href: "/reports/giao-nhan", key: "giao_nhan", label: "Giao nhận" },
  { href: "/reports/doi-chieu", key: "doi_chieu", label: "Đối chiếu" },
  { href: "/reports/van-tai", key: "van_tai", label: "Vận tải" },
  { href: "/reports/vong-doi", key: "vong_doi", label: "Vòng đời đơn" },
];

const ROLE_TABS: Record<string, string[]> = {
  ADMIN: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  MANAGER: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  PURCHASE: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  DISPATCHER: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  SALES: ["thuc_giao", "van_tai"],
  VIEWER: ["thuc_giao", "van_tai"],
  ACCOUNTANT: ["thuc_giao", "van_tai"],
  ACCOUNT: ["thuc_giao"],
};

export function ReportSubNav() {
  const pathname = usePathname();
  const [role, setRole] = useState("VIEWER");

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      setRole(String(u.role || "VIEWER").toUpperCase());
    } catch {
      /* ignore */
    }
  }, []);

  const allowed = ROLE_TABS[role] || ROLE_TABS.VIEWER;
  const tabs = ALL_TABS.filter((t) => allowed.includes(t.key));

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
      {tabs.map((t) => {
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
