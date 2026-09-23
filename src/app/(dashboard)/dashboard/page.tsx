"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VolumeCompareChart } from "@/components/VolumeCompareChart";

function fmt(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export default function DashboardPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    receivingTons: 0,
    deliveryTons: 0,
    receivingPrev: 0,
    deliveryPrev: 0,
    plans: 0,
    payables: 0,
    periodNote: "",
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const u = JSON.parse(localStorage.getItem("user") || "{}");
    const role = String(u.role || "").toUpperCase();
    if (!token) {
      router.push("/");
      return;
    }
    if (role !== "ADMIN" && role !== "MANAGER") {
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
      const year = new Date().getFullYear();
      try {
        const [rv, rd, r3, r4] = await Promise.all([
          fetch(
            `/api/v1/reports/volume-compare?mode=ytd&metric=receiving&groupBy=phanloai&year=${year}`,
            { headers }
          ),
          fetch(
            `/api/v1/reports/volume-compare?mode=ytd&metric=delivery&groupBy=phanloai&year=${year}`,
            { headers }
          ),
          fetch(`/api/v1/reports/plans?year=${year}&pageSize=1`, { headers }),
          fetch(`/api/v1/reports/payables?year=${year}`, { headers }),
        ]);
        const jv = await rv.json();
        const jd = await rd.json();
        const j3 = await r3.json();
        const j4 = await r4.json();

        const sumSeries = (j: {
          success?: boolean;
          data?: { series?: { current?: number; previous?: number }[]; meta?: { periodNote?: string } };
        }) => {
          const series = j.data?.series || [];
          return series.reduce(
            (a, s) => ({
              current: a.current + (Number(s.current) || 0),
              previous: a.previous + (Number(s.previous) || 0),
            }),
            { current: 0, previous: 0 }
          );
        };
        const recv = sumSeries(jv);
        const del = sumSeries(jd);
        const note =
          jv.data?.meta?.periodNote ||
          jv.meta?.periodNote ||
          "";

        setStats({
          receivingTons: recv.current,
          deliveryTons: del.current,
          receivingPrev: recv.previous,
          deliveryPrev: del.previous,
          plans: j3.meta?.total ?? 0,
          payables: j4.data?.summary?.length ?? 0,
          periodNote: note,
        });
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (!allowed) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">Đang chuyển hướng…</div>
    );
  }

  const cards = [
    {
      label: "Thực nhận YTD (tấn)",
      value: fmt(stats.receivingTons),
      sub: `Cùng kỳ trước: ${fmt(stats.receivingPrev)}`,
      href: "/reports/receiving",
      color: "from-blue-500 to-blue-600",
    },
    {
      label: "Thực giao YTD (tấn)",
      value: fmt(stats.deliveryTons),
      sub: `Cùng kỳ trước: ${fmt(stats.deliveryPrev)}`,
      href: "/reports/thuc-giao",
      color: "from-emerald-500 to-emerald-600",
    },
    {
      label: "Kế hoạch SL",
      value: String(stats.plans),
      sub: "Chương trình đang có",
      href: "/plans",
      color: "from-violet-500 to-violet-600",
    },
    {
      label: "Công nợ NCC",
      value: String(stats.payables),
      sub: "Số nhà cung cấp",
      href: "/payables",
      color: "from-amber-500 to-amber-600",
    },
  ];

  return (
    <div className="space-y-5 max-w-full">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Tổng quan</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Admin / Manager ·{" "}
          {stats.periodNote || "Sản lượng từ đầu năm đến hôm qua"}
        </p>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-6">Đang tải số liệu…</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="rounded-xl p-4 text-white shadow-sm bg-gradient-to-br hover:opacity-95 transition"
              style={{}}
            >
              <div className={`rounded-xl p-4 bg-gradient-to-br ${c.color} h-full`}>
                <div className="text-[11px] font-medium opacity-90">{c.label}</div>
                <div className="text-2xl font-bold mt-1 tabular-nums">{c.value}</div>
                <div className="text-[10px] mt-1 opacity-80">{c.sub}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <VolumeCompareChart />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          href="/orders"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 shadow-sm"
        >
          <div className="font-semibold text-slate-800 text-sm">Đơn hàng</div>
          <div className="text-xs text-slate-500 mt-1">Quản lý đặt hàng NCC</div>
        </Link>
        <Link
          href="/details"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 shadow-sm"
        >
          <div className="font-semibold text-slate-800 text-sm">Chi tiết xe</div>
          <div className="text-xs text-slate-500 mt-1">Nhận hàng / trạng thái</div>
        </Link>
        <Link
          href="/deliveries"
          className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 shadow-sm"
        >
          <div className="font-semibold text-slate-800 text-sm">Giao hàng</div>
          <div className="text-xs text-slate-500 mt-1">Thực giao khách</div>
        </Link>
      </div>
    </div>
  );
}
