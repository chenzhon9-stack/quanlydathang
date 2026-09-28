"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type ClientUser,
  readClientUser,
  visibleNavItems,
} from "@/lib/nav-access";

export function MobileNav() {
  const pathname = usePathname();
  const [user, setUser] = useState<ClientUser>({});

  useEffect(() => {
    setUser(readClientUser());
  }, []);

  const tabs = visibleNavItems(user);
  if (!tabs.length) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-area-pb">
      <div className="flex items-center justify-around h-14 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.href.startsWith("/reports")
            ? pathname.startsWith("/reports")
            : pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center flex-1 min-w-[3.2rem] h-full text-[10px] transition ${
                active ? "text-blue-600 font-semibold" : "text-slate-500"
              }`}
            >
              <span className="text-base mb-0.5">{tab.icon}</span>
              <span className="truncate max-w-[3.5rem]">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
