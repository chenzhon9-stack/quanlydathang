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
  const [propItems, setPropItems] = useState<
    Array<{
      key: string;
      value: string;
      displayValue: string;
      source: "env" | "sheet" | "gas";
      readOnly: boolean;
      isSecret: boolean;
      ghiChu?: string;
      updatedAt?: string;
      updatedBy?: string;
    }>
  >([]);
  const [propLoading, setPropLoading] = useState(false);
  const [propBusy, setPropBusy] = useState(false);
  const [propForm, setPropForm] = useState({
    key: "",
    value: "",
    ghiChu: "",
    source: "sheet" as "sheet" | "gas",
  });
  const [propEditKey, setPropEditKey] = useState<string | null>(null);
  const [gasReady, setGasReady] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);
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

  
  const loadProps = useCallback(async () => {
    setPropLoading(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(
        `/api/v1/admin/system/properties?year=${year}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.success) {
        setPropItems(json.data?.items || []);
        setGasReady(Boolean(json.data?.gasReady));
        setGasError(json.data?.gasError ? String(json.data.gasError) : null);
      }
    } catch {
      /* ignore */
    } finally {
      setPropLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadStats();
    loadProps();
  }, [year, loadStats, loadProps]);


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


  async function saveProp() {
    if (!propForm.key.trim()) {
      alert("Nhập Key");
      return;
    }
    setPropBusy(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/v1/admin/system/properties", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: propForm.key.trim(),
          value: propForm.value,
          ghiChu: propForm.source === "sheet" ? propForm.ghiChu : undefined,
          year,
          source: propForm.source,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Lưu thất bại");
        return;
      }
      if (json.data?.unchanged) {
        alert("Secret giữ nguyên (giá trị ******** — không ghi đè).");
      }
      setPropForm({ key: "", value: "", ghiChu: "", source: "sheet" });
      setPropEditKey(null);
      await loadProps();
    } catch {
      alert("Không kết nối API");
    } finally {
      setPropBusy(false);
    }
  }

  async function removeProp(key: string) {
    if (!confirm(`Xóa property «${key}» trên Sheet System_Config?`)) return;
    setPropBusy(true);
    try {
      const token = localStorage.getItem("token") || "";
      const res = await fetch(
        `/api/v1/admin/system/properties?key=${encodeURIComponent(key)}&year=${year}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!json.success) {
        alert(json.error?.message || "Xóa thất bại");
        return;
      }
      await loadProps();
    } catch {
      alert("Không kết nối API");
    } finally {
      setPropBusy(false);
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


      {/* Properties — parity GAS getSystemProperties / updateSystemProperty */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              Properties (cấu hình)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <strong>env</strong> = Vercel (chỉ đọc) · <strong>gas</strong> = Script
              Properties qua webhook · <strong>sheet</strong> ={" "}
              <code className="bg-slate-100 px-1 rounded">System_Config</code>
            </p>
            {gasError && (
              <p className="text-[11px] text-amber-700 mt-1">
                GAS Properties: {gasError}
                {!gasReady && " — bổ sung action getSystemProperties trong doPost + Deploy."}
              </p>
            )}
            {gasReady && !gasError && (
              <p className="text-[11px] text-emerald-700 mt-1">
                Đã kết nối GAS Script Properties.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={loadProps}
            disabled={propLoading}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"
          >
            {propLoading ? "Đang tải…" : "Tải lại"}
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-100 rounded-lg mb-3">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Key</th>
                <th className="text-left px-2 py-1.5 font-medium">Giá trị</th>
                <th className="text-left px-2 py-1.5 font-medium">Nguồn</th>
                <th className="text-left px-2 py-1.5 font-medium">Ghi chú</th>
                <th className="text-right px-2 py-1.5 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {propItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-slate-400 text-center">
                    {propLoading ? "Đang tải…" : "Chưa có property"}
                  </td>
                </tr>
              )}
              {propItems.map((p) => (
                <tr key={`${p.source}-${p.key}`} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-800">
                    {p.key}
                    {p.isSecret && (
                      <span className="ml-1 text-[10px] text-amber-700">secret</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600 break-all max-w-[220px]">
                    {p.displayValue || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                        p.source === "env"
                          ? "bg-violet-50 text-violet-800"
                          : p.source === "gas"
                            ? "bg-sky-50 text-sky-800"
                            : "bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {p.source}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-500 max-w-[160px] truncate">
                    {p.ghiChu || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {!p.readOnly && (
                      <>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline mr-2"
                          disabled={propBusy}
                          onClick={() => {
                            setPropEditKey(p.key);
                            setPropForm({
                              key: p.key,
                              value: p.isSecret ? "" : p.value,
                              ghiChu: p.ghiChu || "",
                              source: p.source === "gas" ? "gas" : "sheet",
                            });
                          }}
                        >
                          Sửa
                        </button>
                        {p.source === "sheet" && (
                          <button
                            type="button"
                            className="text-rose-600 hover:underline"
                            disabled={propBusy}
                            onClick={() => removeProp(p.key)}
                          >
                            Xóa
                          </button>
                        )}
                      </>
                    )}
                    {p.readOnly && (
                      <span className="text-slate-400 text-[10px]">chỉ đọc</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-xs font-medium text-slate-700">
            {propEditKey
              ? `Sửa «${propEditKey}» (${propForm.source})`
              : "Thêm / cập nhật property"}
          </div>
          <div className="grid sm:grid-cols-4 gap-2">
            <label className="text-[11px] text-slate-600 block">
              Nguồn
              <select
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white disabled:bg-slate-100"
                value={propForm.source}
                disabled={!!propEditKey || propBusy}
                onChange={(e) =>
                  setPropForm((f) => ({
                    ...f,
                    source: e.target.value === "gas" ? "gas" : "sheet",
                  }))
                }
              >
                <option value="sheet">Sheet System_Config</option>
                <option value="gas">GAS Script Properties</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-600 block">
              Key *
              <input
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-mono bg-white disabled:bg-slate-100"
                value={propForm.key}
                disabled={!!propEditKey || propBusy}
                onChange={(e) =>
                  setPropForm((f) => ({ ...f, key: e.target.value }))
                }
                placeholder="VD: FEATURE_FLAG_X"
              />
            </label>
            <label className="text-[11px] text-slate-600 block">
              Value {propEditKey?.match(/SECRET|TOKEN|SALT|PASSWORD|KEY/i) ? "(để trống = giữ cũ nếu secret)" : ""}
              <input
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-mono bg-white"
                value={propForm.value}
                disabled={propBusy}
                onChange={(e) =>
                  setPropForm((f) => ({ ...f, value: e.target.value }))
                }
                placeholder="Giá trị"
              />
            </label>
            <label className="text-[11px] text-slate-600 block">
              Ghi chú
              <input
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white"
                value={propForm.ghiChu}
                disabled={propBusy}
                onChange={(e) =>
                  setPropForm((f) => ({ ...f, ghiChu: e.target.value }))
                }
                placeholder="Mô tả ngắn"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={propBusy}
              onClick={saveProp}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {propBusy ? "Đang lưu…" : propEditKey ? "Cập nhật" : "Thêm mới"}
            </button>
            {propEditKey && (
              <button
                type="button"
                disabled={propBusy}
                onClick={() => {
                  setPropEditKey(null);
                  setPropForm({ key: "", value: "", ghiChu: "", source: "sheet" });
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white"
              >
                Hủy
              </button>
            )}
          </div>
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
