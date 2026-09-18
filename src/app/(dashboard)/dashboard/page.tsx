"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function DashboardPage() {
  const [stats, setStats] = useState({
    receiving: 0,
    deliveries: 0,
    plans: 0,
    payables: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    async function load() {
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [r1, r2, r3, r4] = await Promise.all([
          fetch("/api/v1/reports/receiving?year=2026&pageSize=1", { headers }),
          fetch("/api/v1/reports/deliveries?year=2026&pageSize=1", { headers }),
          fetch("/api/v1/reports/plans?year=2026&pageSize=1", { headers }),
          fetch("/api/v1/reports/payables?year=2026", { headers }),
        ]);
        const j1 = await r1.json();
        const j2 = await r2.json();
        const j3 = await r3.json();
        const j4 = await r4.json();
        setStats({
          receiving: j1.meta?.total ?? 0,
          deliveries: j2.meta?.total ?? 0,
          plans: j3.meta?.total ?? 0,
          payables: j4.data?.summary?.length ?? 0,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const cards = [
    { title: "Thực nhận", value: stats.receiving, href: "/reports/receiving", color: "bg-blue-500", desc: "Chi tiết đã nhận hàng" },
    { title: "Thực giao", value: stats.deliveries, href: "/deliveries", color: "bg-emerald-500", desc: "Lượt giao hàng" },
    { title: "Kế hoạch SL", value: stats.plans, href: "/plans", color: "bg-violet-500", desc: "Kế hoạch sản lượng" },
    { title: "Công nợ NCC", value: stats.payables, href: "/reports/receiving", color: "bg-amber-500", desc: "Nhà cung cấp" },
  ];

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Tổng quan</h2>
        <p className="text-xs text-slate-500">Dữ liệu mock năm 2026 · Light theme</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-400 text-sm">Đang tải...</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {cards.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm hover:shadow-md transition"
            >
              <div className={`w-10 h-10 rounded-xl ${c.color} mb-3 flex items-center justify-center text-white text-sm font-bold`}>
                {c.value}
              </div>
              <div className="text-sm font-semibold text-slate-800">{c.title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{c.desc}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="p-4 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-800 leading-relaxed">
        <strong>Giai đoạn mock.</strong> UI: sidebar desktop · card mobile (Đơn/Chi tiết/Giao/KH) · bảng desktop · nút hành động theo V21.
        Nút hiện tại là mock (alert). Bước tiếp: nối Service Account + API thật.
      </div>
    </div>
  );
}
