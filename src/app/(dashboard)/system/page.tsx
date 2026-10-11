"use client";

import { useCallback, useEffect, useState } from "react";
import { currentYearVN } from "@/lib/sheets/date";

type Stats = {
  year: number;
  today?: string;
  usersTotal: number;
  usersActive: number;
  usersPending: number;
  ordersTotal: number;
  ordersToday: number;
  ordersProcessing: number;
  cacheEntries: number;
  cacheWarning: number;
  sheetsConfigured?: boolean;
};

type ActionDef = {
  action: string;
  label: string;
  desc: string;
  confirm?: string;
  group: "data" | "infra";
  danger?: boolean;
};

const ACTIONS: ActionDef[] = [
  {
    action: "capNhatThucTeKeHoach",
    label: "Cập nhật thực tế kế hoạch",
    desc: "ThucTe = Σ CT.ThucNhan (NCC+HH, kỳ đến hết hôm qua) + ghi TrangThai. Throttle 30s.",
    confirm: "Tính lại ThucTe/TrangThai toàn bộ KHSANLUONG năm đang chọn?",
    group: "data",
  },
  {
    action: "repairAllOrderStatuses",
    label: "Sửa trạng thái đơn hàng",
    desc: "3 bước: SoLuong←GH, TrangThaiXe (hao hụt), TrangThaiDon. Throttle 30s.",
    confirm: "Chạy đồng bộ trạng thái cho toàn bộ đơn năm đang chọn?",
    group: "data",
  },
  {
    action: "repairOrderedDetailsForSentOrders",
    label: "Đồng bộ trạng thái xe đã gửi",
    desc: "CT «Mới tạo» + đơn đã gửi (_isOrderSent_: TT đơn / LanGui / ChoGuiMail / timeGuimail) → «Đặt hàng».",
    confirm: "Cập nhật các chi tiết xe lệch trạng thái gửi?",
    group: "data",
  },
  {
    action: "repairDataDrift",
    label: "Sửa lệch dữ liệu (alias)",
    desc: "Alias của «Sửa trạng thái đơn hàng».",
    confirm: "Chạy repair data drift (đồng bộ trạng thái đơn)?",
    group: "data",
  },
  {
    action: "normalizeLegacyDeliveryIdsDryRun",
    label: "Xem trước chuẩn hoá ID GH cũ",
    desc: "Liệt kê ID_Giaohang không khớp GH-yyMMdd-####.",
    group: "data",
  },
  {
    action: "normalizeLegacyDeliveryIdsApply",
    label: "Áp dụng chuẩn hoá ID GH cũ",
    desc: "Phase 1: chưa đổi key trên Vercel — xem hướng dẫn GAS.",
    confirm: "Tiếp tục? (Hiện chỉ báo cáo, chưa ghi ID mới)",
    group: "data",
    danger: true,
  },
  {
    action: "checkCacheHealth",
    label: "Kiểm tra sức khoẻ cache",
    desc: "Cache RAM instance Vercel (không đo KB sheet GAS).",
    group: "infra",
  },
  {
    action: "clearMasterCache",
    label: "Xoá sheet cache",
    desc: "Xoá cache instance hiện tại; instance khác giữ tối đa ~TTL 45s.",
    group: "infra",
  },
  {
    action: "validateStandardSchema",
    label: "Kiểm tra schema chuẩn",
    desc: "Đọc header dòng 1 thật vs STANDARD_HEADERS.",
    group: "infra",
  },
  {
    action: "setupStandardSchema",
    label: "Thiết lập schema chuẩn",
    desc: "Append header thiếu vào cuối dòng 1 (không xoá cột thừa).",
    confirm: "Bổ sung header thiếu theo STANDARD_HEADERS?",
    group: "infra",
  },
  {
    action: "purgeOldSystemCounters",
    label: "Dọn System_Counter cũ (dry-run)",
    desc: "Liệt kê counter > 60 ngày (min 7), bỏ __LOCK__* — chưa xoá hàng.",
    group: "infra",
  },
];

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SystemPage() {
  const [year, setYear] = useState(currentYearVN());
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [resultText, setResultText] = useState("Chưa chạy lệnh nào.");
  const [toast, setToast] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/v1/admin/system?year=${year}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        setResultText("❌ Lỗi tải thống kê: " + (json.error?.message || res.status));
        return;
      }
      setStats(json.data as Stats);
      if (json.data?.cacheWarning > 0) {
        setToast("Cache đang có nhiều entry — cân nhắc xoá cache instance.");
      }
    } catch (e) {
      setResultText("❌ Không kết nối API thống kê.");
    } finally {
      setLoadingStats(false);
    }
  }, [year]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function runAction(def: ActionDef) {
    if (def.confirm && !window.confirm(def.confirm)) return;
    setBusyAction(def.action);
    setResultText(`⏳ ${def.label}…`);
    try {
      const res = await fetch("/api/v1/admin/system", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: def.action, year, days: 60 }),
      });
      const json = await res.json();
      if (!json.success) {
        setResultText(
          "❌ Lỗi: " + (json.error?.message || JSON.stringify(json))
        );
        return;
      }
      setResultText(
        `✅ ${def.label}\n\n` + JSON.stringify(json.data ?? json, null, 2)
      );
      // Auto refresh stats after repair
      if (
        def.action === "repairAllOrderStatuses" ||
        def.action === "repairDataDrift" ||
        def.action === "capNhatThucTeKeHoach" ||
        def.action === "clearMasterCache"
      ) {
        loadStats();
      }
    } catch {
      setResultText("❌ Không kết nối API.");
    } finally {
      setBusyAction(null);
    }
  }

  const cards = stats
    ? [
        { label: "Tổng tài khoản", value: stats.usersTotal, tone: "slate" },
        { label: "Đang hoạt động", value: stats.usersActive, tone: "emerald" },
        { label: "Chờ duyệt", value: stats.usersPending, tone: "amber" },
        { label: "Tổng đơn (năm)", value: stats.ordersTotal, tone: "blue" },
        { label: "Đơn hôm nay", value: stats.ordersToday, tone: "violet" },
        { label: "Đang xử lý", value: stats.ordersProcessing, tone: "sky" },
        {
          label: "Cache entries",
          value: stats.cacheEntries,
          tone: stats.cacheWarning ? "rose" : "slate",
        },
      ]
    : [];

  const toneCls: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    violet: "bg-violet-50 border-violet-200 text-violet-900",
    sky: "bg-sky-50 border-sky-200 text-sky-900",
    rose: "bg-rose-50 border-rose-200 text-rose-900",
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Hệ thống</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Bảo trì dữ liệu & hạ tầng — chỉ Admin (parity V21 KHỐI 6)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 flex items-center gap-1">
            Năm
            <input
              type="number"
              className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || currentYearVN())}
            />
          </label>
          <button
            type="button"
            onClick={loadStats}
            disabled={loadingStats}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {loadingStats ? "Đang tải…" : "Tải thống kê"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm px-3 py-2 flex justify-between gap-2">
          <span>{toast}</span>
          <button type="button" className="text-xs underline" onClick={() => setToast(null)}>
            Đóng
          </button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl border px-3 py-3 ${toneCls[c.tone] || toneCls.slate}`}
          >
            <div className="text-[11px] font-medium opacity-80">{c.label}</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{c.value}</div>
          </div>
        ))}
        {!stats && (
          <div className="col-span-full text-sm text-slate-500 py-6 text-center">
            {loadingStats ? "Đang tải thống kê…" : "Bấm «Tải thống kê»"}
          </div>
        )}
      </div>

      {/* Data repair */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">
          Sửa & đồng bộ dữ liệu
        </h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Các lệnh ghi Sheet — nên chạy ngoài giờ cao điểm. Có xác nhận trước khi ghi.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {ACTIONS.filter((a) => a.group === "data").map((a) => (
            <button
              key={a.action}
              type="button"
              disabled={!!busyAction}
              onClick={() => runAction(a)}
              className={`text-left rounded-lg border px-3 py-2.5 hover:bg-slate-50 disabled:opacity-50 ${
                a.danger ? "border-rose-200" : "border-slate-200"
              }`}
            >
              <div className="text-sm font-medium text-slate-800">
                {busyAction === a.action ? "⏳ Đang chạy…" : a.label}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{a.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Infra */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">
          Hạ tầng & Cache
        </h2>
        <p className="text-[11px] text-slate-500 mb-3">
          Cache Vercel theo instance (warm). Schema so với STANDARD_HEADERS.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {ACTIONS.filter((a) => a.group === "infra").map((a) => (
            <button
              key={a.action}
              type="button"
              disabled={!!busyAction}
              onClick={() => runAction(a)}
              className="text-left rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50 disabled:opacity-50"
            >
              <div className="text-sm font-medium text-slate-800">
                {busyAction === a.action ? "⏳ Đang chạy…" : a.label}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{a.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Result box */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-800">Kết quả</h2>
          <button
            type="button"
            className="text-[11px] text-slate-500 underline"
            onClick={() => setResultText("Chưa chạy lệnh nào.")}
          >
            Xoá
          </button>
        </div>
        <pre
          className="text-[11px] sm:text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-all text-slate-800"
        >
          {resultText}
        </pre>
      </section>
    </div>
  );
}
