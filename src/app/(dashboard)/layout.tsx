"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileNav } from "@/components/MobileNav";
import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<{ hoTen: string; role: string } | null>(
    null
  );

  useEffect(() => {
    const token = localStorage.getItem("token");
    const u = localStorage.getItem("user");
    if (!token || !u) {
      router.push("/");
      return;
    }
    setUser(JSON.parse(u));
  }, [router]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/");
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 text-sm">Đang tải...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar user={user} onLogout={logout} />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-tight">
              Quản lý Đặt hàng
            </h1>
            <p className="text-xs text-slate-500">
              {user.hoTen} · {user.role}
            </p>
          </div>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600"
          >
            Thoát
          </button>
        </header>

        <main className="flex-1 p-3 md:p-5 lg:p-6 pb-20 md:pb-6">{children}</main>
      </div>

      <MobileNav />
    </div>
  );
}
