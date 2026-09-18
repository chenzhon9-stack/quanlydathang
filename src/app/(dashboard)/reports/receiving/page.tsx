"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";

export default function ReceivingReportPage() {
  const [rows, setRows] = useState<
    Array<{
      detailId: string;
      productName?: string;
      productId: string;
      quantity: number;
      actualReceived?: number;
      status: string;
    }>
  >([]);
  const [meta, setMeta] = useState<{ total?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    fetch("/api/v1/reports/receiving?year=2026&pageSize=50", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setRows(json.data || []);
          setMeta(json.meta);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-xs text-blue-600 mb-1 inline-block"
          >
            ← Tổng quan
          </Link>
          <h2 className="text-lg font-semibold text-slate-800">Thực nhận</h2>
        </div>
        <span className="text-xs text-slate-500">
          {meta?.total ?? 0} dòng
        </span>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-400 text-sm">
          Đang tải...
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Hàng hóa</th>
                  <th className="px-3 py-2.5 text-right font-medium">KH</th>
                  <th className="px-3 py-2.5 text-right font-medium">TN</th>
                  <th className="px-3 py-2.5 text-left font-medium">TT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.detailId} className="border-t border-slate-100">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">
                        {r.productName || r.productId}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {r.detailId}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.quantity?.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">
                      {r.actualReceived?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
