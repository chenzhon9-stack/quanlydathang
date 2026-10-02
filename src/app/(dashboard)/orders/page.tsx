"use client";

import { ACTION, clientHasAny, readClientUser } from "@/lib/nav-access";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ListToolbar,
  toggleStatus,
  matchStatuses,
  matchSearch,
} from "@/components/ListToolbar";
import { StatusBadge } from "@/components/StatusBadge";
import { statusRowClass } from "@/lib/status-styles";
import type { Order } from "@/types";
import { apiPost } from "@/components/ActionPrompt";
import { downloadExcelHtml } from "@/lib/export-excel";
import { CreateOrderModal } from "@/components/CreateOrderModal";
import { AddDetailModal } from "@/components/AddDetailModal";
import { OrderManageModal } from "@/components/OrderManageModal";
import {
  SendActionModal,
  type SendAction,
} from "@/components/SendActionModal";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Khởi tạo",
  PROCESSING: "Đang xử lý",
  DONE: "Hoàn thành",
  CANCEL: "Hủy đơn",
};

/**
 * Ma trận nút tab Đơn hàng — parity V21 (permission + business rule):
 *
 * Nguồn:
 * - roleAccess / ORDER_* matrix (admin|purchase|dispatcher)
 * - LanGui: 0 = chưa gửi; >0 = đã gửi NCC
 * - cancelOrder: ORDER_CANCEL; BE chặn khi đã có xe nhận (D112)
 * - resetOrder: admin|purchase (+canReset: quá hạn ngày + còn CT chưa nhận)
 * - sendOrder / gửi lại: ORDER_SEND; gửi lại khi GuiLaimail
 * - Quản lý xe (openOrderFlow): ORDER_UPDATE
 *   · Chưa gửi → nút "Thêm" trên list
 *   · Đã gửi → mở qua click Mã đơn (V21 openOrderFlow), không nhét "Sửa" vào cột Hành động
 * - PDF: cột riêng khi có FileDonhang (không trộn vào Hành động)
 */
function OrderActions({
  o,
  onChanged,
  onManageOrder,
  onNeedSendAction,
}: {
  o: Order;
  onChanged?: () => void;
  onManageOrder?: (o: Order) => void;
  onNeedSendAction?: (payload: {
    orderId: string;
    message: string;
    isDuyenHa?: boolean;
    dayDiff?: number;
  }) => void;
}) {
  const user = readClientUser();
  const canUpdate = clientHasAny(user, [...ACTION.orderUpdate]);
  const canSend = clientHasAny(user, [...ACTION.orderSend]);
  const canCancel = clientHasAny(user, [...ACTION.orderCancel]);
  // Reset: API đã gắn o.canReset (ngày + còn xe chưa nhận); quyền admin/purchase
  const canResetBtn =
    clientHasAny(user, [...ACTION.orderUpdate, ...ACTION.orderCancel]) &&
    Boolean(o.canReset);

  const raw = String(o.status || "");
  const st = raw.toUpperCase();
  const isCancel =
    st === "CANCEL" ||
    st.includes("HỦY") ||
    st.includes("HUY") ||
    raw.includes("Hủy");
  const isDone =
    st === "DONE" ||
    st.includes("HOÀN") ||
    st.includes("HOAN") ||
    raw === "Hoàn thành";
  const lanGui = Number(o.sendCount) || 0;
  const neverSent = lanGui === 0;
  const hasDetails = (Number(o.detailCount) || 0) > 0;
  const terminal = isCancel || isDone;

  async function cancelOrder(label: string) {
    if (!confirm(`${label} đơn ${o.orderId}?`)) return;
    const json = await apiPost(
      `/api/v1/orders/${encodeURIComponent(o.orderId)}/cancel`,
      { year: new Date().getFullYear() }
    );
    if (!json.success) {
      alert(json.error?.message || `Lỗi ${label.toLowerCase()} đơn`);
      return;
    }
    onChanged?.();
  }

  async function sendOrder(isResend: boolean) {
    const lan = Number(o.sendCount) || 0;
    const nccLine = o.supplierName
      ? `\nNCC: ${o.supplierName} (${o.supplierId || ""})`
      : o.supplierId
        ? `\nNCC: ${o.supplierId}`
        : "";
    if (
      !confirm(
        (isResend
          ? `Gửi lại đơn ${o.orderId}?`
          : `Gửi đơn ${o.orderId} tới NCC?`) +
          nccLine +
          `\nLần gửi hiện tại: ${lan}` +
          `\n(Hình thức theo DM_NCC: Email / Zalo / APP)` +
          `\n\nXác nhận?`
      )
    )
      return;
    // V21: gửi lần đầu / gửi lại (GuiLaimail) đều gọi sendOrderEmail(maDon, email, null)
    // sendAction "send"|"reset"|"cancel"|"markSent" CHỈ dùng khi modal gửi muộn
    const json = await apiPost(
      `/api/v1/orders/${encodeURIComponent(o.orderId)}/send`,
      {
        year: new Date().getFullYear(),
        sendAction: "",
        resend: isResend,
      }
    );
    if (!json.success) {
      alert(
        json.error?.message ||
          (isResend ? "Gửi lại thất bại" : "Gửi đơn thất bại")
      );
      return;
    }
    const data = json.data as {
      needConfirm?: boolean;
      message?: string;
      channel?: string;
      notifiedNcc?: boolean;
      appGuide?: boolean;
      isDuyenHa?: boolean;
      dayDiff?: number;
    };
    if (data?.needConfirm) {
      onNeedSendAction?.({
        orderId: o.orderId,
        message: data.message || "Đơn gửi muộn.",
        isDuyenHa: data.isDuyenHa,
        dayDiff:
          typeof data.dayDiff === "number" ? data.dayDiff : undefined,
      });
      return;
    }
    const ch = (data?.channel || "").toLowerCase();
    // APP: cảnh báo mở app NCC — không gửi mail/Zalo
    if (data?.appGuide || ch === "app") {
      alert(
        data?.message ||
          `NCC nhận đơn qua APP.\nVui lòng mở ứng dụng nhà cung cấp để đặt đơn ${o.orderId}.`
      );
      onChanged?.();
      return;
    }
    const base =
      data?.message ||
      (isResend ? "Đã gửi lại đơn." : "Đã gửi đơn.");
    const extra =
      ch.includes("zalo")
        ? "\nKênh: Zalo — kiểm tra ZaloUserId trên DM_NCC và tin nhắn Zalo OA."
        : ch.includes("email") || ch.includes("mail")
          ? "\nKênh: Email."
          : "";
    alert(base + extra);
    onChanged?.();
  }

  if (terminal) {
    return <span className="text-[11px] text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {/* V21: chưa gửi → Thêm (openOrderFlow / OrderManage) */}
      {neverSent && canUpdate && (
        <button
          type="button"
          onClick={() => onManageOrder?.(o)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200"
        >
          Thêm
        </button>
      )}

      {/* Gửi — ORDER_SEND · LanGui=0 · có ≥1 CT */}
      {neverSent && canSend && (
        <button
          type="button"
          disabled={!hasDetails}
          title={
            !hasDetails ? "Cần thêm ít nhất 1 xe trước khi gửi" : undefined
          }
          onClick={() => sendOrder(false)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Gửi
        </button>
      )}

      {/* Xóa — ORDER_CANCEL · chưa gửi · không có CT đã nhận (V21 D112) */}
      {neverSent && canCancel && o.canCancelOrder !== false && (
        <button
          type="button"
          onClick={() => cancelOrder("Xóa")}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-500"
        >
          Xóa
        </button>
      )}

      {/* Hủy — ORDER_CANCEL · đã gửi · ẩn khi ≥1 xe đã nhận/giao (V21 D112; BE enforce) */}
      {!neverSent && canCancel && o.canCancelOrder !== false && (
        <button
          type="button"
          onClick={() => cancelOrder("Hủy")}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-500"
        >
          Hủy
        </button>
      )}

      {/* Reset — quá hạn ngày + còn xe chưa nhận (o.canReset từ API) */}
      {canResetBtn && (
        <button
          type="button"
          onClick={async () => {
            if (
              !confirm(
                `Reset đơn ${o.orderId}?\nXe chưa nhận sẽ về mã/đơn mới; xe đã nhận giữ nguyên.`
              )
            )
              return;
            const json = await apiPost(
              `/api/v1/orders/${encodeURIComponent(o.orderId)}/reset`,
              { year: new Date().getFullYear() }
            );
            if (!json.success) {
              alert(json.error?.message || "Reset thất bại");
              return;
            }
            alert(
              (json.data as { message?: string })?.message || "Đã reset đơn"
            );
            onChanged?.();
          }}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-amber-500 text-white hover:bg-amber-400"
        >
          Reset
        </button>
      )}

      {/* Gửi lại — ORDER_SEND · GuiLaimail */}
      {Boolean(o.resendMail) && canSend && (
        <button
          type="button"
          onClick={() => sendOrder(true)}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-violet-600 text-white hover:bg-violet-500"
        >
          Gửi lại
        </button>
      )}
    </div>
  );
}


export default function OrdersPage() {
  const [statuses, setStatuses] = useState<string[]>(["ALL"]);
  const [search, setSearch] = useState("");
  // Deep-link /orders?q=MaDon từ tab CT/GH
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setSearch(q);
  }, []);
  const [groupByDate, setGroupByDate] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const pageUser = readClientUser();
  const canCreateOrder = clientHasAny(pageUser, [...ACTION.orderCreate]);
  const [addTarget, setAddTarget] = useState<Order | null>(null);
  const [manageOrderId, setManageOrderId] = useState<string | null>(null);
  const [sendModal, setSendModal] = useState<{
    open: boolean;
    orderId: string;
    message: string;
    isDuyenHa?: boolean;
    dayDiff?: number;
    loading: boolean;
  }>({ open: false, orderId: "", message: "", loading: false });

  const load = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        year: "2026",
        page: "1",
        pageSize: "100",
      });

      const res = await fetch(`/api/v1/orders?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.error?.message || "Lỗi tải đơn");
        setOrders([]);
        setTotal(0);
        return;
      }
      // STEP 5 list shape: data.items
      const data = json.data;
      setOrders(data.items || data || []);
      setTotal(data.total ?? (data.items?.length || 0));
    } catch {
      setErr("Không kết nối được API");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNeedSendAction = useCallback(
    (payload: {
      orderId: string;
      message: string;
      isDuyenHa?: boolean;
      dayDiff?: number;
    }) => {
      setSendModal({
        open: true,
        orderId: payload.orderId,
        message: payload.message,
        isDuyenHa: payload.isDuyenHa,
        dayDiff: payload.dayDiff,
        loading: false,
      });
    },
    []
  );

  const handleSendActionConfirm = useCallback(
    async (action: SendAction) => {
      setSendModal((s) => ({ ...s, loading: true }));
      try {
        const orderId = sendModal.orderId;
        // reset → API resetOrder (mọi NCC); còn lại → send + sendAction
        const path =
          action === "reset"
            ? `/api/v1/orders/${encodeURIComponent(orderId)}/reset`
            : `/api/v1/orders/${encodeURIComponent(orderId)}/send`;
        const body =
          action === "reset"
            ? { year: new Date().getFullYear() }
            : {
                year: new Date().getFullYear(),
                sendAction: action,
              };
        const json = await apiPost(path, body);
        if (!json.success) {
          alert(json.error?.message || "Thao tác thất bại");
          setSendModal((s) => ({ ...s, loading: false }));
          return;
        }
        const d2 = json.data as { message?: string; newOrderId?: string };
        alert(
          d2?.message ||
            (action === "reset" && d2?.newOrderId
              ? `Đã reset → ${d2.newOrderId}`
              : "OK")
        );
        setSendModal({
          open: false,
          orderId: "",
          message: "",
          loading: false,
        });
        load();
      } catch (e) {
        alert("Lỗi: " + (e instanceof Error ? e.message : String(e)));
        setSendModal((s) => ({ ...s, loading: false }));
      }
    },
    [sendModal.orderId, load]
  );

  const handleSendActionCancel = useCallback(() => {
    setSendModal((s) => {
      if (s.loading) return s;
      return { open: false, orderId: "", message: "", loading: false };
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Chuẩn hóa ngày đặt → yyyy-MM-dd (nhóm ổn định dù API trả full datetime) */
  const orderDateKey = (d?: string) => {
    const s = String(d || "").trim();
    if (!s) return "";
    // yyyy-MM-dd or yyyy-MM-ddTHH:mm...
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // dd/MM/yyyy
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m2) {
      const dd = m2[1].padStart(2, "0");
      const mm = m2[2].padStart(2, "0");
      return `${m2[3]}-${mm}-${dd}`;
    }
    return s.slice(0, 10);
  };

  /** Sort: Ngày đặt DESC → Mã đơn DESC */
  const sortOrders = (list: Order[]) =>
    [...list].sort((a, b) => {
      const da = orderDateKey(a.orderDate);
      const db = orderDateKey(b.orderDate);
      const d = db.localeCompare(da);
      if (d) return d;
      return String(b.orderId || "").localeCompare(String(a.orderId || ""));
    });

  const filtered = useMemo(() => {
    const list = orders.filter((o) => {
      if (!matchStatuses(o.status, statuses)) return false;
      const hay = [
        o.orderId,
        o.supplierId,
        o.supplierName || "",
        o.status,
        o.orderDate,
        o.createdBy || "",
      ].join(" ");
      return matchSearch(hay, search);
    });
    return sortOrders(list);
  }, [orders, statuses, search]);

  const displayGroups: { key: string; items: Order[] }[] = useMemo(() => {
    if (!groupByDate) {
      return [{ key: "all", items: filtered }];
    }
    const byDate: Record<string, Order[]> = {};
    for (const o of filtered) {
      const k = orderDateKey(o.orderDate) || "(không ngày)";
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push(o);
    }
    // Ngày đặt DESC; trong nhóm đã sort mã đơn DESC từ filtered
    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
    return dates.map((d) => ({
      key: d,
      items: sortOrders(byDate[d]),
    }));
  }, [filtered, groupByDate]);

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Đơn hàng</h2>
          <p className="text-xs text-slate-500">
            {total} đơn · qua API /api/v1/orders
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load()}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
          >
            Tải lại
          </button>
          <button
            onClick={() => {
              downloadExcelHtml(
                `DonHang_${new Date().toISOString().slice(0, 10)}.xls`,
                "DonHang",
                ["Mã đơn", "Ngày", "NCC", "TT", "Số CT", "User"],
                filtered.map((o) => [
                  o.orderId,
                  o.orderDate,
                  o.supplierName || o.supplierId,
                  o.status,
                  o.detailCount,
                  o.createdBy || "",
                ])
              );
            }}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 text-white"
          >
            Xuất CSV
          </button>
          {canCreateOrder && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white"
          >
            + Thêm đơn
          </button>
          )}
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Tìm (Và: + · Hoặc: ;) — mã đơn, NCC…"
        statuses={[
          { key: "ALL", label: "Tất cả" },
          { key: "NEW", label: "Khởi tạo" },
          { key: "PROCESSING", label: "Đang xử lý" },
          { key: "DONE", label: "Hoàn thành" },
          { key: "CANCEL", label: "Hủy đơn" },
        ]}
        selectedStatuses={statuses}
        onToggleStatus={(k) => setStatuses((s) => toggleStatus(s, k))}
        groupByDate={groupByDate}
        onGroupByDate={setGroupByDate}
        countLabel={`${filtered.length}/${orders.length} đơn`}
      />

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Đang tải đơn hàng...</div>
      ) : (
        <>
          {/* Mobile cards — nhóm theo ngày đặt khi bật */}
          <div className="md:hidden space-y-3">
            {displayGroups.map((g) => (
              <React.Fragment key={`m-${g.key}`}>
                {groupByDate && g.key !== "all" && (
                  <div className="sticky top-0 z-10 rounded-lg bg-slate-700 text-white text-xs font-medium px-3 py-2">
                    📅 Ngày đặt:{" "}
                    {/^\d{4}-\d{2}-\d{2}$/.test(g.key)
                      ? g.key.split("-").reverse().join("/")
                      : g.key}
                    <span className="ml-2 opacity-80">({g.items.length})</span>
                  </div>
                )}
                {g.items.map((o) => (
              <div
                key={o.orderId}
                className={`rounded-2xl border p-4 shadow-sm ${
                  statusRowClass(o.status)
                } border-slate-200`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {(() => {
                      const stU = String(o.status || "").toUpperCase();
                      const terminalRow =
                        stU === "CANCEL" ||
                        stU === "DONE" ||
                        stU.includes("HỦY") ||
                        stU.includes("HOÀN");
                      const canOpen =
                        !terminalRow &&
                        clientHasAny(pageUser, [...ACTION.orderUpdate]);
                      return canOpen ? (
                        <button
                          type="button"
                          onClick={() => setManageOrderId(o.orderId)}
                          className="text-sm font-bold text-blue-700 underline break-all text-left"
                        >
                          {o.orderId}
                        </button>
                      ) : (
                        <span className="text-sm font-bold text-blue-700 break-all">
                          {o.orderId}
                        </span>
                      );
                    })()}
                    <div className="text-xs text-slate-500 mt-0.5">
                      {o.orderDate}
                    </div>
                  </div>
                  <StatusBadge status={STATUS_LABEL[o.status] || o.status} />
                </div>
                <div className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">NCC</span>
                    <span className="font-medium text-right">
                      {o.supplierName || o.supplierId}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Tổng CT</span>
                    <span className="font-medium">
                      {o.detailCount}
                      {o.cancelledDetailCount
                        ? ` (hủy ${o.cancelledDetailCount})`
                        : ""}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Lần gửi</span>
                    <span className="font-medium">{o.sendCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Người tạo</span>
                    <span className="font-medium text-right text-xs break-all max-w-[60%]">
                      {o.createdBy || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 items-center">
                    <span className="text-slate-500">PDF</span>
                    {o.orderFile ? (
                      <a
                        href={o.orderFile}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-red-600 text-sm font-semibold"
                      >
                        📄 Mở PDF
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">Chưa có</span>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200/80">
                  <OrderActions
                    o={o}
                    onChanged={load}
                    onManageOrder={(ord) => setManageOrderId(ord.orderId)}
                    onNeedSendAction={handleNeedSendAction}
                  />
                </div>
              </div>
                ))}
              </React.Fragment>
            ))}
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-500 text-sm space-y-2">
                <p>Không có đơn hàng (API trả 0 dòng).</p>
                <p className="text-xs text-slate-400">
                  Nếu vừa nối Sheet: kiểm tra log Vercel hoặc gọi{" "}
                  <code className="bg-slate-100 px-1 rounded">/api/v1/debug/sheets</code>
                </p>
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left font-semibold">Mã đơn</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Ngày đặt</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Nhà cung cấp</th>
                    <th className="px-3 py-2.5 text-right font-semibold">CT</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
                    <th className="px-3 py-2.5 text-center font-semibold">PDF</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Người tạo</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {displayGroups.map((g) => (
                    <React.Fragment key={`g-${g.key}`}>
                      {groupByDate && g.key !== "all" && (
                        <tr className="bg-slate-700 text-white">
                          <td colSpan={8} className="px-3 py-2 text-xs font-medium">
                            📅 Ngày đặt lệnh:{" "}
                            {/^\d{4}-\d{2}-\d{2}$/.test(g.key)
                              ? g.key.split("-").reverse().join("/")
                              : g.key}
                            <span className="ml-2 opacity-80">
                              ({g.items.length} đơn)
                            </span>
                          </td>
                        </tr>
                      )}
                      {g.items.map((o) => {
                        const stU = String(o.status || "").toUpperCase();
                        const terminalRow =
                          stU === "CANCEL" ||
                          stU === "DONE" ||
                          stU.includes("HỦY") ||
                          stU.includes("HOÀN");
                        const canOpenManage =
                          !terminalRow &&
                          clientHasAny(pageUser, [...ACTION.orderUpdate]);
                        return (
                        <tr
                          key={o.orderId}
                          className={`border-t border-slate-100 ${
                            statusRowClass(o.status)
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            {canOpenManage ? (
                              <button
                                type="button"
                                title="Mở quản lý đơn (V21 openOrderFlow)"
                                onClick={() => setManageOrderId(o.orderId)}
                                className="font-semibold text-blue-700 underline hover:text-blue-900 text-left"
                              >
                                {o.orderId}
                              </button>
                            ) : (
                              <span className="font-semibold text-blue-700">
                                {o.orderId}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                            {o.orderDate}
                          </td>
                          <td className="px-3 py-2.5 max-w-[220px] truncate">
                            {o.supplierName || o.supplierId}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{o.detailCount}</td>
                          <td className="px-3 py-2.5">
                            <StatusBadge status={STATUS_LABEL[o.status] || o.status} />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {o.orderFile ? (
                              <a
                                href={o.orderFile}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Mở file đơn hàng"
                                className="inline-flex text-red-600 hover:text-red-700 text-base"
                              >
                                📄
                              </a>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 truncate max-w-[140px]">
                            {o.createdBy}
                          </td>
                          <td className="px-3 py-2.5">
                            <OrderActions
                              o={o}
                              onChanged={load}
                              onManageOrder={(ord) =>
                                setManageOrderId(ord.orderId)
                              }
                              onNeedSendAction={handleNeedSendAction}
                            />
                          </td>
                        </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !err && (
              <div className="text-center py-12 text-slate-500 text-sm space-y-2">
                <p>Không có đơn hàng (API trả 0 dòng).</p>
                <p className="text-xs text-slate-400">
                  Nếu vừa nối Sheet: kiểm tra log Vercel hoặc gọi{" "}
                  <code className="bg-slate-100 px-1 rounded">/api/v1/debug/sheets</code>
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <CreateOrderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          alert("Đã tạo đơn " + id);
          load();
        }}
      />
      <AddDetailModal
        order={addTarget}
        onClose={() => setAddTarget(null)}
        onAdded={() => {
          alert("Đã thêm xe vào đơn");
          load();
        }}
      />
      <OrderManageModal
        orderId={manageOrderId}
        year={new Date().getFullYear()}
        onClose={() => setManageOrderId(null)}
        onSaved={() => load()}
      />
      <SendActionModal
        open={sendModal.open}
        message={sendModal.message}
        isDuyenHa={sendModal.isDuyenHa}
        dayDiff={sendModal.dayDiff}
        loading={sendModal.loading}
        onCancel={handleSendActionCancel}
        onConfirm={handleSendActionConfirm}
      />
    </div>
  );
}

