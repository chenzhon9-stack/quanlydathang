"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VolumeCompareChart } from "@/components/VolumeCompareChart";

export default function DashboardPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    receiving: 0,
    deliveries: 0,
    plans: 0,
    payables: 0,
  });
  const [volumeSource, setVolumeSource] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const u = JSON.parse(localStorage.getItem("user") || "{}");
    const role = String(u.role || "").toUpperCase();
    if (!token) {
      router.push("/");
      return;
    }
    // Chỉ ADMIN / MANAGER — theo yêu cầu
    if (role !== "ADMIN" && role !== "MANAGER") {
      // sales/viewer → báo cáo thực giao; purchase → orders
      if (role === "SALES" || role === "VIEWER" || role === "ACCOUNTANT") {
        router.replace("/reports/thuc-giao");
      } else if (role === "PURCHASE" || role === "DISPATCHER") {
        router.replace("/orders");
      } else {
        router.replace("/deliveries");
      }
      return;
    }
    setAllowed(true);

    async function load() {
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [r1, r2, r3, r4, rv] = await Promise.all([
          fetch("/api/v1/reports/receiving?year=2026&pageSize=1", { headers }),
          fetch("/api/v1/reports/thuc-giao?year=2026&pageSize=1", { headers }).catch(() =>
            fetch("/api/v1/reports/deliveries?year=2026&pageSize=1", { headers })
          ),
          fetch("/api/v1/reports/plans?year=2026&pageSize=1", { headers }),
          fetch("/api/v1/reports/payables?year=2026", { headers }),
          fetch("/api/v1/reports/volume-compare?mode=ytd&metric=receiving&year=2026", {
            headers,
          }),
        ]);
        const j1 = await r1.json();
        const j2 = await r2.json();
        const j3 = await r3.json();
        const j4 = await r4.json();
        const jv = await rv.json();
        setStats({
          receiving: j1.meta?.total ?? j1.data?.length ?? 0,
          deliveries: j2.meta?.total ?? j2.data?.total ?? j2.data?.length ?? 0,
          plans: j3.meta?.total ?? 0,
          payables: j4.data?.summary?.length ?? 0,
        });
        if (jv.meta?.source) setVolumeSource(jv.meta.source);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (!allowed) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        Đang chuyển hướng…
      </div>
    );
  }

  const cards = [
    {
      title: "Thực nhận",
      value: stats.receiving,
      href: "/reports/receiving",
      color: "bg-blue-500",
      desc: "Chi tiết đã nhận hàng",
    },
    {
      title: "Thực giao",
      value: stats.deliveries,
      href: "/reports/thuc-giao",
      color: "bg-emerald-500",
      desc: "Lượt giao hàng",
    },
    {
      title: "Kế hoạch SL",
      value: stats.plans,
      href: "/plans",
      color: "bg-violet-500",
      desc: "Kế hoạch sản lượng",
    },
    {
      title: "Công nợ NCC",
      value: stats.payables,
      href: "/payables",
      color: "bg-amber-500",
      desc: "Nhà cung cấp",
    },
  ];

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Tổng quan</h2>
        <p className="text-xs text-slate-500">
          Dashboard Admin/Manager · số liệu Sheet
          {volumeSource ? ` · volume: ${volumeSource}` : ""}
        </p>
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
              <div
                className={`w-10 h-10 rounded-xl ${c.color} mb-3 flex items-center justify-center text-white text-sm font-bold`}
              >
                {c.title.slice(0, 1)}
              </div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">
                {c.value.toLocaleString("vi-VN")}
              </div>
              <div className="text-sm font-medium text-slate-700 mt-1">{c.title}</div>
              <div className="text-[11px] text-slate-400">{c.desc}</div>
            </Link>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          So sánh sản lượng (Bao / Rời / Khác)
        </h3>
        <VolumeCompareChart />
      </div>
    </div>
  );
}
