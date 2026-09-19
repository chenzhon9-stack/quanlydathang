"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab visibility = UI projection of Permission Matrix (skill 7.9) */
const NAV: Array<{
  href: string;
  label: string;
  icon: string;
  roles?: string[]; // empty = all
}> = [
  { href: "/dashboard", label: "Tổng quan", icon: "📊" },
  {
    href: "/orders",
    label: "Đơn hàng",
    icon: "📋",
    roles: ["ADMIN", "PURCHASE", "DISPATCHER"],
  },
  {
    href: "/details",
    label: "Chi tiết xe",
    icon: "🚚",
    roles: ["ADMIN", "PURCHASE", "DISPATCHER"],
  },
  { href: "/deliveries", label: "Giao hàng", icon: "📦" },
  {
    href: "/plans",
    label: "Kế hoạch SL",
    icon: "📈",
    roles: ["ADMIN", "MANAGER"],
  },
  { href: "/reports/receiving", label: "Báo cáo", icon: "📑" },
  {
    href: "/payables",
    label: "Công nợ NCC",
    icon: "💰",
    roles: ["ADMIN", "MANAGER", "PURCHASE", "ACCOUNTANT"],
  },
  {
    href: "/users",
    label: "Tài khoản",
    icon: "👤",
    roles: ["ADMIN"],
  },
];

export function Sidebar({
  user,
  onLogout,
}: {
  user: { hoTen: string; role: string };
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const role = user.role?.toUpperCase() || "";

  const visible = NAV.filter(
    (item) => !item.roles || item.roles.includes(role) || role === "ADMIN"
  );

  return (
    <aside className="flex flex-col w-full h-full bg-white">
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-sm">
            VH
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">VIẾT HẢI</div>
            <div className="text-[10px] text-slate-400">Quản lý đặt hàng</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {visible.map((item) => {
          const active =
            item.href === "/reports/receiving"
              ? pathname.startsWith("/reports")
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                active
                  ? "bg-blue-600 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-700">
        <div className="text-xs text-slate-400 mb-1">Người dùng</div>
        <div className="text-sm font-medium truncate">{user.hoTen}</div>
        <div className="text-[11px] text-slate-500 mb-3">{user.role}</div>
        <button
          onClick={onLogout}
          className="w-full text-left text-sm text-slate-300 hover:text-white px-2 py-1.5 rounded hover:bg-slate-800"
        >
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}
