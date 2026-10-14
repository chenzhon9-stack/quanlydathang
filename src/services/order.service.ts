import { postGasWebhook, rememberGasIdempotency, gasWebhookUrl } from "@/lib/gas-webhook";
import { isOrderSentLike } from "@/lib/order-resend";
import {
  todayYmdVN,
  currentYearVN,
  formatDateTimeVN,
  ymdDate,
} from "@/lib/sheets/date";
import type { AccessScope, Order, UserContext } from "@/types";
import { hasPermission, resolveScope } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds, applyListScopeFilter } from "@/lib/scope";
import { OrderRepository } from "@/repositories/order.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { updateSheetRowByKey, invalidateSheetCache } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { writeAudit } from "@/lib/sheets/audit";
import { generateMaDon, resolveMaDonClock } from "@/lib/sheets/ma-don";
import { appendSheetRow, readSheetAsObjects } from "@/lib/sheets/dal";
import { STATUS_DON, STATUS_CT } from "@/lib/status";
import { canResetOrder, isDuyenHaNcc, businessDayDiff, lateThresholdDays } from "@/lib/order-reset";
import { syncOrderStatusByOrderId } from "@/lib/sync-order-status";

export interface OrderListFilter {
  year?: number;
  fromDate?: string;
  toDate?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderListResult {
  items: Order[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * OrderService — STEP 5 + AccessScope MANAGEMENT (V21 Quanly `;`)
 */

/** Kênh gửi NCC từ DM_NCC.HinhThucGui */
async function resolveNccChannel(supplierId: string): Promise<{
  hinhThucGui: string;
  channel: "email" | "zalo" | "app" | "unknown";
}> {
  let hinhThucGui = "";
  try {
    const rows = await MasterRepository.list("NCC");
    const id = String(supplierId || "").trim().toUpperCase();
    const ncc = rows.find(
      (r) =>
        String(r.MaNCC || r.id || "")
          .trim()
          .toUpperCase() === id
    );
    if (ncc) {
      hinhThucGui = String(
        (ncc as { HinhThucGui?: string }).HinhThucGui ||
          (ncc as { hinhThucGui?: string }).hinhThucGui ||
          ""
      ).trim();
    }
  } catch {
    /* ignore */
  }
  const n = hinhThucGui
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  let channel: "email" | "zalo" | "app" | "unknown" = "unknown";
  if (n.includes("zalo")) channel = "zalo";
  else if (n.includes("app") || n.includes("ungdung")) channel = "app";
  else if (n.includes("email") || n.includes("mail") || n === "") channel = "email";
  return { hinhThucGui, channel };
}

/**
 * Gọi GAS sendOrderFromWebhook (PDF/mail/Zalo / cancel notify).
 * Không tăng LanGui phía Vercel — GAS xử lý.
 */
async function gasSendOrderFromWebhook(
  maDon: string,
  email: string,
  sendAction: string | null,
  opts?: { idempotencyKey?: string }
): Promise<{ ok: boolean; body: Record<string, unknown>; message: string }> {
  const url = gasWebhookUrl();
  if (!url) {
    return {
      ok: false,
      body: {},
      message: "Chưa cấu hình GAS_SEND_ORDER_URL",
    };
  }
  const idKey =
    opts?.idempotencyKey ||
    `sendOrderFromWebhook:${maDon}:${sendAction || "default"}:${email}`;
  try {
    const gasRes = await postGasWebhook(
      {
        action: "sendOrderFromWebhook",
        maDon,
        email,
        sendAction: sendAction || null,
      },
      { timeoutMs: 55_000, idempotencyKey: idKey }
    );
    const body = gasRes.body || {};
    const ok = body.success === true && !body._gasHtml;
    if (ok) {
      try {
        rememberGasIdempotency(idKey, gasRes);
      } catch {
        /* ignore */
      }
    }
    const message = String(
      body.message || body.error || (ok ? "OK" : `GAS HTTP ${gasRes.status}`)
    );
    return { ok, body, message };
  } catch (e) {
    return {
      ok: false,
      body: {},
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export class OrderService {
  static async listOrders(
    filter: OrderListFilter,
    user: UserContext,
    scope: AccessScope
  ): Promise<OrderListResult> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    let orders = await OrderRepository.findMany({
      year: filter.year,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      status: filter.status,
      supplierId: filter.supplierId,
    });

    // V21.07 multi-role: OWNER ∪ MANAGEMENT ∪ OWN_CUSTOMER
    orders = await applyListScopeFilter(orders, scope, filter.year);

    const nccMap = await MasterRepository.nccNames();
    const nccSend = await MasterRepository.nccSendMethods();
    const resolveSend = (sid: string) => {
      const k = String(sid || "").trim();
      if (!k) return "";
      return (
        nccSend[k] ||
        nccSend[k.toUpperCase()] ||
        nccSend[k.toLowerCase()] ||
        ""
      );
    };
    orders = orders.map((o) => ({
      ...o,
      supplierName: o.supplierName || nccMap[o.supplierId] || o.supplierId,
      sendMethod: o.sendMethod || resolveSend(o.supplierId) || "",
    }));

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = orders.length;
    const start = (page - 1) * pageSize;
    let items = orders.slice(start, start + pageSize);

    // V21: canReset / canCancelOrder — load CT năm 1 lần
    // hasUnreceived: còn xe chưa nhận (reset)
    // hasReceived: ≥1 CT ThucNhan>0 hoặc status ∈ {Đã nhận, Đang giao, Hoàn thành}
    // Fail-closed: lỗi load CT → canCancelOrder = false
    const hasUnreceived = new Map<string, boolean>();
    const hasReceived = new Map<string, boolean>();
    let ctMetaOk = true;
    try {
      const { DetailRepository } = await import(
        "@/repositories/detail.repository"
      );
      const allCt = await DetailRepository.findMany({ year: filter.year });
      for (const d of allCt) {
        const stRaw = String(d.status || "").trim();
        const st = stRaw.toUpperCase();
        if (st === "DELETE" || stRaw === STATUS_CT.DELETE) continue;
        const oid = String(d.orderId || "");
        if (!oid) continue;

        const receivedQty = Number(d.actualReceived) || 0;
        // V21 _cancelOrderCore_: chỉ ThucNhan>0 hoặc RECEIVED/DELIVERING/DONE
        const isRecvStatus =
          receivedQty > 0 ||
          stRaw === STATUS_CT.RECEIVED ||
          stRaw === STATUS_CT.DELIVERING ||
          stRaw === STATUS_CT.DONE;

        if (isRecvStatus) {
          hasReceived.set(oid, true);
        } else if (!hasReceived.has(oid)) {
          hasReceived.set(oid, false);
        }

        const unrecv =
          receivedQty === 0 &&
          st !== "CANCEL" &&
          stRaw !== STATUS_CT.CANCEL;
        if (unrecv) {
          hasUnreceived.set(oid, true);
        } else if (!hasUnreceived.has(oid)) {
          hasUnreceived.set(oid, false);
        }
      }
    } catch (e) {
      ctMetaOk = false;
      console.error("[listOrders] canReset/canCancel CT load", e);
    }

    const isTerminalOrder = (status: string) => {
      const raw = String(status || "");
      const st = raw.toUpperCase();
      return (
        st === "CANCEL" ||
        st === "DONE" ||
        st.includes("HỦY") ||
        st.includes("HUY") ||
        st.includes("HOÀN") ||
        st.includes("HOAN") ||
        raw.includes("Hủy đơn") ||
        raw === "Hoàn thành"
      );
    };

    items = items.map((o) => {
      const reset = canResetOrder({
        status: o.status,
        orderDate: o.orderDate,
        orderDateTime: o.orderDateTime,
        supplierId: o.supplierId,
        sendCount: o.sendCount,
        hasUnreceivedVehicle: hasUnreceived.get(o.orderId) === true,
      });
      // V21 canCancel: !hasReceived; thêm ẩn terminal + fail-closed khi CT lỗi
      const canCancelOrder =
        ctMetaOk &&
        !isTerminalOrder(String(o.status || "")) &&
        hasReceived.get(o.orderId) !== true;
      return { ...o, canReset: reset.ok, canCancelOrder };
    });

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }

  static async getOrder(
    maDon: string,
    user: UserContext,
    scope: AccessScope,
    year?: number
  ): Promise<Order> {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem đơn hàng",
      };
    }

    const order = await OrderRepository.findById(maDon, year);
    if (!order) {
      throw { code: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" };
    }

    // V21.07 multi-role: pass nếu BẤT KỲ nhánh scope match (union)
    if (scope.scopeType !== "ALL") {
      const allowOwner =
        scope.scopeType === "OWNER" ||
        scope.scopeType === "UNION" ||
        !!scope.allowOwner;
      const allowMgmt =
        scope.scopeType === "MANAGEMENT" ||
        scope.scopeType === "UNION" ||
        !!scope.allowManagement;
      let ok = false;
      if (
        allowOwner &&
        scope.ownerEmail &&
        (order.createdBy || "").toLowerCase() ===
          scope.ownerEmail.toLowerCase()
      ) {
        ok = true;
      }
      if (!ok && allowMgmt) {
        const allowed = await resolveAllowedSupplierIds({
          ...scope,
          scopeType: "MANAGEMENT",
        });
        // null = quanly all → mọi NCC
        if (allowed === null) {
          ok = true;
        } else if (
          order.supplierId &&
          (allowed.has(order.supplierId) ||
            allowed.has(String(order.supplierId).toUpperCase()))
        ) {
          ok = true;
        }
      }
      if (!ok) {
        throw {
          code: "SCOPE_DENIED",
          message: "Không thuộc phạm vi dữ liệu của bạn",
        };
      }
    }

    const nccMap = await MasterRepository.nccNames();
    const nccSend = await MasterRepository.nccSendMethods();
    return {
      ...order,
      supplierName:
        order.supplierName || nccMap[order.supplierId] || order.supplierId,
      sendMethod:
        order.sendMethod ||
        nccSend[order.supplierId] ||
        nccSend[String(order.supplierId || "").toUpperCase()] ||
        "",
    };
  }


  /**
   * Hủy đơn — V21 cancelOrder
   * Chặn nếu bất kỳ CT còn active có ThucNhan>0 hoặc TT ∈ RECEIVED/DELIVERING/DONE
   * Cascade: CT active → Hủy xe; soft-delete GH chưa giao
   */
  static async cancelOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    // P0: hủy đơn chỉ ORDER_CANCEL / * — không dùng ORDER_UPDATE thay thế
    if (
      !hasPermission(user, "ORDER_CANCEL") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền hủy đơn" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const y = year ?? currentYearVN();

    const { DetailRepository } = await import("@/repositories/detail.repository");
    const { DeliveryRepository } = await import(
      "@/repositories/delivery.repository"
    );
    const { OrderRepository } = await import(
      "@/repositories/order.repository"
    );

    const order = await OrderRepository.findById(orderId, y);
    if (!order) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy đơn " + orderId };
    }
    // P0: scope / OWNER — không hủy đơn ngoài phạm vi
    {
      const scope = resolveScope(user);
      const visible = await applyListScopeFilter([order], scope, y);
      if (!visible.length) {
        throw {
          code: "PERMISSION_DENIED",
          message: "Đơn ngoài phạm vi quản lý — không được hủy.",
        };
      }
    }

    const details = await DetailRepository.findMany({
      year: y,
      orderId,
    });
    if (!details.length) {
      // vẫn cho hủy header nếu không có CT
    }

    const blocked = details.filter((d) => {
      const st = String(d.status || "").trim();
      const received = Number(d.actualReceived) || 0;
      if (received > 0) return true;
      if (
        [
          STATUS_CT.RECEIVED,
          STATUS_CT.DELIVERING,
          STATUS_CT.DONE,
          "Đã nhận",
          "Đang giao",
          "Hoàn thành",
        ].includes(st)
      )
        return true;
      return false;
    });
    if (blocked.length) {
      throw {
        code: "VALIDATION_ERROR",
        message:
          `Không hủy được đơn ${orderId}: còn ${blocked.length} xe đã nhận/giao ` +
          `(${blocked
            .slice(0, 3)
            .map((d) => d.detailId)
            .join(", ")}).`,
      };
    }

    // 1) Quét toàn bộ GH trước khi ghi — tránh hủy dở nếu có thực giao
    const activeDetails = details.filter((d) => {
      const st = String(d.status || "").trim();
      return st !== STATUS_CT.CANCEL && st !== STATUS_CT.DELETE;
    });
    for (const d of activeDetails) {
      const ghs = await DeliveryRepository.findMany({
        year: y,
        detailId: d.detailId,
        includeDeleted: false,
      });
      for (const g of ghs) {
        if ((Number(g.actualQty) || 0) > 0) {
          throw {
            code: "VALIDATION_ERROR",
            message: `Xe ${d.detailId} đã có thực giao, không hủy đơn.`,
          };
        }
      }
    }

    // 2) Soft-delete GH + hủy CT
    let cancelledCt = 0;
    let deletedGh = 0;
    const now = formatDateTimeVN();
    for (const d of activeDetails) {
      const ghs = await DeliveryRepository.findMany({
        year: y,
        detailId: d.detailId,
        includeDeleted: false,
      });
      for (const g of ghs) {
        const r = await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          g.deliveryId,
          { Deleted: true, DeletedAt: now, DeletedBy: user.email },
          y
        );
        if (r > 0) deletedGh++;
      }

      const r = await updateSheetRowByKey(
        SHEETS.CT,
        "ID_Chitiet",
        d.detailId,
        {
          TrangThaiXe: STATUS_CT.CANCEL,
          ThucNhan: 0,
          TimeChange: now,
          User: user.email,
        },
        y
      );
      if (r > 0) cancelledCt++;
    }

    // V21: TongSoChitiet / ChitietHuy = mọi CT khác DELETE
    const tongSo = details.filter((d) => {
      const st = String(d.status || "").trim();
      return (
        st !== STATUS_CT.DELETE &&
        st !== "DELETE" &&
        !String(st).includes("Xóa")
      );
    }).length;
    const chitietHuy = tongSo; // sau hủy toàn đơn: mọi CT non-DELETE đều Hủy

    // V21 _isOrderSent_ ≈ isOrderSentLike
    const wasEverSent = isOrderSentLike({
      status: order.status,
      sendCount: order.sendCount,
      pendingMail: (order as { pendingMail?: boolean }).pendingMail,
      resendMail: (order as { resendMail?: boolean }).resendMail,
      mailSentAt: (order as { mailSentAt?: string }).mailSentAt,
      timeGuimail:
        (order as { timeGuimail?: string }).timeGuimail ||
        (order as { mailSentAt?: string }).mailSentAt,
      sentAt: (order as { sentAt?: string }).sentAt,
    });
    const isDha = isDuyenHaNcc(order.supplierId);
    const dayDiff = businessDayDiff(
      String(order.orderDateTime || order.orderDate || ""),
      isDha
    );
    // V21 _lateThresholdDays_: DHA 1, NCC khác 2
    const lateThreshold = lateThresholdDays(isDha);
    const isExpired = dayDiff !== null && dayDiff >= lateThreshold;

    const { channel, hinhThucGui } = await resolveNccChannel(order.supplierId);
    // APP: không báo mail/Zalo; GuiLaimail=false (trigger bỏ qua đơn Hủy)
    const shouldNotifyNcc =
      wasEverSent && !isExpired && channel !== "app";

    const row = await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        TrangThaiDon: STATUS_DON.CANCEL,
        TongSoChitiet: tongSo,
        ChitietHuy: chitietHuy,
        GuiLaimail: shouldNotifyNcc,
        ChoGuiMail: false,
      },
      y
    );
    if (row < 0)
      throw { code: "NOT_FOUND", message: "Không tìm thấy đơn " + orderId };

    let notifiedNcc = false;
    let notifyFailed = false;
    let notifyNote = "";
    if (channel === "app" && wasEverSent && !isExpired) {
      notifyNote = `Hình thức APP (${hinhThucGui || "APP"}) — không gửi mail/Zalo hủy cho NCC.`;
    } else if (shouldNotifyNcc) {
      if (gasWebhookUrl()) {
        const gas = await gasSendOrderFromWebhook(
          orderId,
          user.email,
          "cancel",
          {
            idempotencyKey: `cancel:${orderId}:lg${Number(order.sendCount) || 0}`,
          }
        );
        notifiedNcc = gas.ok;
        notifyFailed = !gas.ok;
        notifyNote = gas.ok
          ? `Đã báo NCC hủy đơn (${channel}).`
          : `Hủy trên Sheet OK; báo NCC thất bại: ${gas.message}`;
      } else {
        notifyFailed = true;
        notifyNote =
          "Đã bật GuiLaimail — chưa cấu hình GAS_SEND_ORDER_URL nên chưa gửi thông báo NCC.";
      }
    } else if (!wasEverSent) {
      notifyNote = "Hủy trước khi gửi NCC — không thông báo NCC.";
    } else if (isExpired) {
      notifyNote = `Hủy quá hạn (${dayDiff} ngày, ngưỡng ${lateThreshold}) — chỉ cập nhật nội bộ, không báo NCC.`;
    }

    const auditAction = !wasEverSent
      ? "CANCEL_ORDER_BEFORE_SEND"
      : isExpired
        ? "CANCEL_ORDER_EXPIRED_NO_NOTIFY"
        : notifiedNcc
          ? "CANCEL_ORDER_NOTIFIED"
          : "CANCEL_ORDER";

    await writeAudit({
      email: user.email,
      role: user.role,
      action: auditAction,
      maDon: orderId,
      targetId: orderId,
      newValue: JSON.stringify({
        cancelledCt,
        deletedGh,
        tongSo,
        chitietHuy,
        wasEverSent,
        isExpired,
        dayDiff,
        lateThreshold,
        notifiedNcc,
        notifyFailed,
        channel,
      }),
      lyDo: notifyNote || "Hủy đơn",
      year: y,
    });

    return {
      orderId,
      cancelledCt,
      deletedGh,
      wasEverSent,
      isExpired,
      dayDiff,
      lateThreshold,
      notifiedNcc,
      notifyFailed,
      channel,
      hinhThucGui,
      message:
        `Đã hủy đơn ${orderId}` +
        (cancelledCt ? ` (${cancelledCt} xe)` : "") +
        (notifyNote ? `. ${notifyNote}` : ""),
    };
  }

  /**
   * Gửi đơn NCC — Strangler V21.
   * APP: Sheet-only + hướng dẫn. Email/Zalo: GAS sendOrderFromWebhook.
   * sendAction: '' | 'send' | 'reset' | 'cancel' | 'markSent'
   */
  static async sendOrder(
    orderId: string,
    user: UserContext,
    year?: number,
    sendAction?: string,
    opts?: { resend?: boolean }
  ) {
    // Chỉ ORDER_SEND (hoặc *) — không fallback role (MANAGER không được gửi)
    if (!hasPermission(user, "ORDER_SEND") && !hasPermission(user, "*")) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền gửi đơn" };
    }

    const y = year ?? currentYearVN();
    const action = String(sendAction || "").trim();
    const gasUrl =
      process.env.GAS_SEND_ORDER_URL || process.env.GAS_WEBHOOK_URL || "";

    // Đọc đơn + NCC để biết hình thức gửi (Email / Zalo) — parity V21 HinhThucGui
    let hinhThucGui = "";
    let zaloUserId = "";
    let emailNcc = "";
    let lanGui = 0;
    let guiLaiMail = false;
    try {
      const orders = await OrderRepository.findMany({ year: y });
      const order = orders.find(
        (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
      );
      if (order) {
        lanGui = Number(order.sendCount) || 0;
        guiLaiMail = !!(order as { resendMail?: boolean }).resendMail;
        const nccRows = await readSheetAsObjects(SHEETS.NCC, {});
        const ncc = nccRows.find(
          (r) =>
            String(r.MaNCC || "").trim().toUpperCase() ===
            String(order.supplierId || "").trim().toUpperCase()
        );
        if (ncc) {
          hinhThucGui = String(
            ncc.HinhThucGui || ncc.HinhThucgui || ncc.HinhThuc || ""
          ).trim();
          zaloUserId = String(ncc.ZaloUserId || ncc.ZaloUserID || "").trim();
          emailNcc = String(ncc.EmailNCC || ncc.Email || "").trim();
        }
      }
    } catch (e) {
      console.warn("[sendOrder] load NCC channel", e);
    }
    // V21 MASTER: HinhThucGui = Email | ZALO | APP → so khớp sau toLowerCase
    const hinhNorm = hinhThucGui
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    const channelHint = (() => {
      if (hinhNorm === "app" || hinhNorm.includes("ung dung")) return "app";
      if (hinhNorm === "zalo") return "zalo";
      if (hinhNorm === "email" || hinhNorm === "mail") return "email";
      if (hinhNorm.includes("zalo")) return "zalo";
      if (hinhNorm.includes("mail") || hinhNorm.includes("email")) return "email";
      return hinhNorm || "unknown";
    })();

    // ─── APP: không phụ thuộc GAS (V21 không gửi mail/Zalo) ───
    // Vercel tự ghi Sheet (LanGui, CT ORDERED, snapshot, LogGuiMail) + hướng dẫn mở APP.
    // Late first (LanGui=0, dayDiff≥1): needConfirm → modal send|reset|cancel|markSent.
    // V21: reset / cancel / markSent chỉ hợp lệ khi LanGui=0 (modal gửi lần đầu muộn).
    if (channelHint === "app") {
      if (!isSheetsConfigured()) {
        throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
      }
      const ordersApp = await OrderRepository.findMany({ year: y });
      const orderApp = ordersApp.find(
        (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
      );
      if (!orderApp) {
        throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
      }

      // Phạm vi — parity _canAccessOrder_
      {
        const scope = resolveScope(user);
        const visible = await applyListScopeFilter([orderApp], scope, y);
        if (!visible.length) {
          throw {
            code: "PERMISSION_DENIED",
            message: "Không có quyền gửi đơn này (ngoài phạm vi).",
          };
        }
      }

      const tenNcc =
        String(orderApp.supplierName || orderApp.supplierId || "").trim() ||
        "nhà cung cấp";
      const lanGuiCur = Number(orderApp.sendCount) || 0;
      const isDha = isDuyenHaNcc(orderApp.supplierId);
      const dayDiff = businessDayDiff(orderApp.orderDate, isDha);
      const lateFirst =
        lanGuiCur === 0 && dayDiff !== null && dayDiff >= 1;

      // Chưa chọn phương án gửi muộn → UI mở SendActionModal
      if (!action && lateFirst) {
        return {
          orderId,
          via: "app" as const,
          needConfirm: true,
          confirmType: "LATE_FIRST_SEND",
          isDuyenHa: isDha,
          dayDiff,
          channel: "app",
          hinhThucGui,
          appGuide: false,
          message:
            `Đơn ${orderId} gửi muộn ${dayDiff} ngày (hình thức APP — ${tenNcc}).\n` +
            `Chọn cách xử lý: Gửi bình thường / Reset đơn / Hủy / Đánh dấu đã gửi.`,
        };
      }

      // reset / cancel / markSent chỉ khi LanGui=0 (modal lần đầu muộn) — V21
      if (
        (action === "reset" || action === "cancel" || action === "markSent") &&
        lanGuiCur > 0
      ) {
        throw {
          code: "INVALID_ACTION",
          message:
            `Hành động "${action}" chỉ dùng khi gửi lần đầu muộn (LanGui=0). ` +
            `Đơn ${orderId} đã gửi ${lanGuiCur} lần — dùng Gửi lại / Hủy / Reset trên danh sách.`,
        };
      }

      // reset → resetOrder (đơn mới + gửi APP hướng dẫn)
      if (action === "reset") {
        const resetRes = await this.resetOrder(orderId, user, y);
        return {
          ...resetRes,
          via: "app" as const,
          channel: "app" as const,
          hinhThucGui,
          needConfirm: false as const,
          message:
            resetRes.message ||
            `Đã reset đơn ${orderId} → ${resetRes.newMaDon || ""} (APP).`,
        };
      }

      // cancel trên modal muộn → hủy đơn thật (không mail/Zalo vì APP)
      if (action === "cancel") {
        const cancelled = await this.cancelOrder(orderId, user, y);
        return {
          ...cancelled,
          via: "app" as const,
          needConfirm: false as const,
          channel: "app" as const,
          hinhThucGui,
          cancelled: true as const,
          message:
            cancelled.message ||
            `Đã hủy đơn ${orderId} (APP — không gửi mail/Zalo).`,
        };
      }

      // markSent | send | "" : cập nhật Sheet + (markSent không bắt mở app)
      const markOnly = action === "markSent";
      const lanGuiNext = lanGuiCur + 1;
      const timeLabel = formatDateTimeVN(new Date());
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        orderId,
        {
          LanGui: lanGuiNext,
          timeGuimail: timeLabel,
          ChoGuiMail: false,
          GuiLaimail: false,
          TrangThaiDon: STATUS_DON.PROCESSING,
          FileDonhang: orderApp.orderFile || "",
        },
        y
      );
      const { DetailRepository } = await import(
        "@/repositories/detail.repository"
      );
      const details = await DetailRepository.findMany({ year: y, orderId });
      let ctUpdated = 0;
      for (const ct of details) {
        const st = String(ct.status || "").toUpperCase();
        if (
          st === "NEW" ||
          st === "" ||
          String(ct.status) === STATUS_CT.NEW ||
          String(ct.status).includes("Mới")
        ) {
          await updateSheetRowByKey(
            SHEETS.CT,
            "ID_Chitiet",
            ct.detailId,
            { TrangThaiXe: STATUS_CT.ORDERED, TimeChange: timeLabel },
            y
          );
          ctUpdated++;
        }
      }

      // Snapshot + LogGuiMail — parity finalizeOrderSent (APP không có PDF)
      try {
        await appendSheetRow(
          SHEETS.SNAPSHOT,
          {
            MaDon: orderId,
            LanGui: lanGuiNext,
            SnapshotJSON: JSON.stringify({
              maDon: orderId,
              lanGui: lanGuiNext,
              channel: "app",
              sendAction: action || "send",
              at: new Date().toISOString(),
              by: user.email,
            }),
            ThoiGianLuu: timeLabel,
          },
          y
        );
      } catch (e) {
        console.warn("[sendOrder APP] snapshot skip", e);
      }
      try {
        await appendSheetRow(
          SHEETS.LOG_GUI_MAIL,
          {
            "Thời gian": timeLabel,
            MaDon: orderId,
            NCC: tenNcc,
            Email: "",
            "Lần gửi": lanGuiNext,
            "Ghi chú": markOnly
              ? "APP — markSent (xử lý ngoài hệ thống)"
              : "APP — cập nhật Sheet, hướng dẫn mở app NCC",
            "Link PDF": orderApp.orderFile || "",
          },
          y
        );
      } catch (e) {
        console.warn("[sendOrder APP] LogGuiMail skip", e);
      }

      await writeAudit({
        email: user.email,
        role: user.role,
        action: markOnly ? "SEND_ORDER_APP_MARK_SENT" : "SEND_ORDER_APP",
        maDon: orderId,
        targetId: orderId,
        newValue: JSON.stringify({
          lanGui: lanGuiNext,
          ctUpdated,
          channel: "app",
          sendAction: action || "send",
        }),
        lyDo: markOnly
          ? "APP — đánh dấu đã gửi (xử lý ngoài hệ thống)"
          : "Hình thức APP — cập nhật Sheet, hướng dẫn mở app NCC",
        year: y,
      });
      return {
        orderId,
        via: "app" as const,
        needConfirm: false,
        notifiedNcc: !markOnly,
        channel: "app",
        hinhThucGui,
        appGuide: !markOnly,
        lanGui: lanGuiNext,
        ctUpdated,
        message: markOnly
          ? `Đã đánh dấu đơn ${orderId} đã gửi (Lần ${lanGuiNext}). Hình thức APP.`
          : `Đơn hàng ${orderId} đã sẵn sàng (Lần gửi ${lanGuiNext}).\n` +
            `Vui lòng mở APP của ${tenNcc} để đặt hàng.\n` +
            `Hệ thống không gửi Email/Zalo cho hình thức APP.`,
      };
    }

    // ─── Nhánh 1: GAS sendOrderFromWebhook → sendOrderEmail() nội bộ (Email / Zalo) ───
    // V21.07+ doPost DEPRECATED sendOrderEmail/sendOrder; webhook dùng tên mới.
    if (gasUrl) {
      // GAS: sendOrderFromWebhook → _WEBHOOK_ACTOR_ + sendOrderEmail(maDon, email, action|null)
      // action: null | send | reset | cancel | markSent
      // Shared postGasWebhook: redirect + HTML detect + timeout + idempotency (P0)
      const GAS_TIMEOUT_MS = 55_000;
      const baselineLanGui = Number(lanGui) || 0;
      const idempotencyKey = `send:${orderId}:lg${baselineLanGui}:${action || "default"}`;
      const payload: Record<string, unknown> = {
        action: "sendOrderFromWebhook",
        maDon: orderId,
        email: user.email,
        sendAction: action || null,
        idempotencyKey,
      };

      let gasRes: {
        status: number;
        body: Record<string, unknown>;
        raw: string;
        aborted?: boolean;
        fromIdempotencyCache?: boolean;
      };

      /** Sau timeout/abort: reload Sheet — nếu LanGui đã tăng thì coi GAS đã gửi (tránh double-send). */
      async function resolveAfterGasAbort(): Promise<{
        orderId: string;
        via: "gas";
        needConfirm: false;
        notifiedNcc: boolean;
        channel: string;
        hinhThucGui: string;
        message: string;
        recoveredFromSheet: true;
      } | null> {
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const afterOrders = await OrderRepository.findMany({ year: y });
            const after = afterOrders.find(
              (o) =>
                String(o.orderId).toUpperCase() ===
                String(orderId).toUpperCase()
            );
            const afterLanGui = Number(after?.sendCount) || 0;
            if (afterLanGui > baselineLanGui) {
              return {
                orderId,
                via: "gas" as const,
                needConfirm: false as const,
                notifiedNcc: true,
                channel: channelHint,
                hinhThucGui,
                recoveredFromSheet: true as const,
                message:
                  `Đã gửi đơn qua GAS (xác nhận Sheet lần ${attempt + 1}: ` +
                  `LanGui ${baselineLanGui} → ${afterLanGui}). Không bấm gửi lại.`,
              };
            }
          } catch (e) {
            console.error(
              `[sendOrder] recover attempt ${attempt + 1} failed`,
              e
            );
          }
        }
        return null;
      }

      gasRes = await postGasWebhook(payload, {
        timeoutMs: GAS_TIMEOUT_MS,
        idempotencyKey,
      });

      // Timeout/abort → poll LanGui (GAS có thể đã gửi sau khi Vercel cắt)
      if (gasRes.aborted || gasRes.body?._idempotencyInFlight) {
        if (gasRes.aborted) {
          const recovered = await resolveAfterGasAbort();
          if (recovered) {
            rememberGasIdempotency(idempotencyKey, {
              status: 200,
              raw: "",
              body: { success: true, recoveredFromSheet: true },
            });
            await writeAudit({
              email: user.email,
              role: user.role,
              action: "SEND_ORDER_GAS_RECOVERED",
              maDon: orderId,
              targetId: orderId,
              newValue: JSON.stringify({
                baselineLanGui,
                message: recovered.message,
              }),
              year: y,
            });
            try {
              invalidateSheetCache([SHEETS.DH, SHEETS.CT, SHEETS.LOG_GUI_MAIL], y);
            } catch {
              /* ignore */
            }
            return recovered;
          }
          throw {
            code: "GAS_SEND_FAILED",
            message:
              `GAS không phản hồi trong ${GAS_TIMEOUT_MS / 1000}s và Sheet chưa tăng LanGui. ` +
              `Đợi ~30s rồi kiểm tra cột LanGui trước khi gửi lại (tránh trùng email).`,
          };
        }
        throw {
          code: "GAS_SEND_IN_FLIGHT",
          message: String(
            gasRes.body?.error ||
              "Đang xử lý gửi trùng — đợi rồi kiểm tra LanGui trên Sheet."
          ),
        };
      }

      const gasBody = gasRes.body;
      console.info("[sendOrder] GAS response", {
        maDon: orderId,
        status: gasRes.status,
        fromCache: gasRes.fromIdempotencyCache || false,
        bodyPreview: JSON.stringify(gasBody).slice(0, 500),
        hint: gasBody._gasHtml ? "GAS trả HTML" : undefined,
      });

      /** Làm sạch message — không bao giờ alert HTML */
      const cleanMsg = (v: unknown, fallback: string) => {
        const s = String(v ?? "").trim();
        if (!s) return fallback;
        if (
          /^<!DOCTYPE/i.test(s) ||
          /^<html[\s>]/i.test(s) ||
          s.includes("<head") ||
          s.includes("ppConfig")
        ) {
          return fallback;
        }
        return s.slice(0, 400);
      };

      // needConfirm LATE_FIRST_SEND — UI hiện modal (mọi kênh kể cả APP)
      if (gasBody.needConfirm) {
        return {
          orderId,
          via: "gas" as const,
          needConfirm: true,
          confirmType: gasBody.confirmType || "LATE_FIRST_SEND",
          isDuyenHa: !!gasBody.isDuyenHa,
          dayDiff: gasBody.dayDiff,
          channel: channelHint,
          hinhThucGui,
          message: cleanMsg(
            gasBody.error || gasBody.message,
            "Cần xác nhận gửi muộn"
          ),
          gas: gasBody,
        };
      }

      if (
        gasBody.success === false ||
        gasBody._gasHtml === true ||
        (gasRes.status >= 400 && gasBody.success !== true)
      ) {
        // HTML/timeout body: GAS có thể đã gửi xong — recover LanGui trước khi báo lỗi
        const recovered = await resolveAfterGasAbort();
        if (recovered) {
          await writeAudit({
            email: user.email,
            role: user.role,
            action: "SEND_ORDER_GAS_RECOVERED",
            maDon: orderId,
            targetId: orderId,
            newValue: JSON.stringify({
              baselineLanGui,
              viaHtmlOrFail: true,
              message: recovered.message,
            }),
            year: y,
          });
          try {
            invalidateSheetCache([SHEETS.DH, SHEETS.CT, SHEETS.LOG_GUI_MAIL], y);
          } catch {
            /* ignore */
          }
          return recovered;
        }
        const errMsg = cleanMsg(
          gasBody.error || gasBody.message,
          `GAS HTTP ${gasRes.status}`
        );
        const hint =
          /unauthorized/i.test(errMsg)
            ? " — Kiểm tra WEBHOOK_SECRET (GAS) khớp WEBHOOK_SECRET/GAS_WEBHOOK_SECRET (Vercel)."
            : /ngừng hỗ trợ|không được hỗ trợ|deprecated|sendOrderEmail/i.test(errMsg)
              ? " — GAS đã bỏ sendOrderEmail; Vercel phải gọi sendOrderFromWebhook (deploy Vercel + doPost V21.08)."
              : /unknown action/i.test(errMsg)
              ? " — doPost chưa có action sendOrderFromWebhook (Deploy New version Web App)."
              : gasBody._gasHtml
                ? " — GAS trả HTML; kiểm tra LanGui trên Sheet trước khi gửi lại."
                : "";
        throw {
          code: "GAS_SEND_FAILED",
          message: errMsg + hint,
          gas: { ...gasBody, rawPreview: undefined },
        };
      }

      await writeAudit({
        email: user.email,
        role: user.role,
        action: "SEND_ORDER_GAS",
        maDon: orderId,
        targetId: orderId,
        newValue: JSON.stringify({
          sendAction: action,
          notifiedNcc: gasBody.notifiedNcc,
          message: cleanMsg(gasBody.message, "ok"),
        }),
        year: y,
      });

      // GAS đã ghi LanGui/CT trên Sheet — xóa cache Vercel để listOrders thấy ngay
      try {
        invalidateSheetCache([SHEETS.DH, SHEETS.CT, SHEETS.LOG_GUI_MAIL], y);
      } catch (e) {
        console.warn("[sendOrder] invalidateSheetCache after GAS", e);
      }

      const notified = gasBody.notifiedNcc !== false;
      // Nhánh GAS chỉ còn email/zalo (APP return sớm phía trên)
      let defaultMsg = "Đã gửi đơn qua GAS.";
      if (channelHint === "zalo") {
        defaultMsg = notified
          ? "Đã gửi đơn qua Zalo (GAS)."
          : "GAS đã xử lý đơn nhưng có thể chưa gửi được Zalo — kiểm tra ZaloUserId trên DM_NCC.";
        if (!zaloUserId) {
          defaultMsg =
            "Hình thức gửi là Zalo nhưng DM_NCC thiếu ZaloUserId — bổ sung mã Zalo NCC rồi gửi lại.";
        }
      } else if (channelHint === "email") {
        defaultMsg = "Đã gửi đơn qua Email (GAS).";
      }
      return {
        orderId,
        via: "gas" as const,
        needConfirm: false,
        notifiedNcc: notified,
        channel: channelHint,
        hinhThucGui,
        appGuide: false,
        zaloUserId: zaloUserId ? "(có)" : "(thiếu)",
        message: cleanMsg(gasBody.message, defaultMsg),
        gas: gasBody,
      };
    }

    // ─── Nhánh 2: Không GAS — chỉ Sheet (không mail/PDF) ───
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
    }
    const orders = await OrderRepository.findMany({ year: y });
    const order = orders.find(
      (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
    );
    if (!order) {
      throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
    }

    const lanGuiNext = (Number(order.sendCount) || 0) + 1;
    const timeLabel = formatDateTimeVN(new Date());

    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        LanGui: lanGuiNext,
        timeGuimail: timeLabel,
        ChoGuiMail: false,
        GuiLaimail: false,
        TrangThaiDon: STATUS_DON.PROCESSING,
        FileDonhang: order.orderFile || "",
      },
      y
    );

    const { DetailRepository } = await import("@/repositories/detail.repository");
    const details = await DetailRepository.findMany({ year: y, orderId });
    let ctUpdated = 0;
    for (const ct of details) {
      const st = String(ct.status || "").toUpperCase();
      if (
        st === "NEW" ||
        st === "" ||
        String(ct.status) === STATUS_CT.NEW ||
        String(ct.status).includes("Mới")
      ) {
        await updateSheetRowByKey(
          SHEETS.CT,
          "ID_Chitiet",
          ct.detailId,
          {
            TrangThaiXe: STATUS_CT.ORDERED,
            TimeChange: timeLabel,
          },
          y
        );
        ctUpdated++;
      }
    }

    try {
      await appendSheetRow(
        SHEETS.SNAPSHOT,
        {
          MaDon: orderId,
          LanGui: lanGuiNext,
          SnapshotJSON: JSON.stringify({
            maDon: orderId,
            lanGui: lanGuiNext,
            at: new Date().toISOString(),
            by: user.email,
          }),
          ThoiGianLuu: timeLabel,
        },
        y
      );
    } catch (e) {
      console.warn("[sendOrder] snapshot skip", e);
    }

    try {
      await appendSheetRow(
        SHEETS.LOG_GUI_MAIL,
        {
          "Thời gian": timeLabel,
          MaDon: orderId,
          NCC: order.supplierName || order.supplierId || "",
          Email: "",
          "Lần gửi": lanGuiNext,
          "Ghi chú": "Gửi Sheet-only (chưa cấu hình GAS_SEND_ORDER_URL)",
          "Link PDF": order.orderFile || "",
        },
        y
      );
    } catch (e) {
      console.warn("[sendOrder] LogGuiMail skip", e);
    }

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "SEND_ORDER_SHEET_ONLY",
      maDon: orderId,
      targetId: orderId,
      newValue: JSON.stringify({ lanGui: lanGuiNext, ctUpdated }),
      year: y,
    });

    return {
      orderId,
      via: "sheet" as const,
      lanGui: lanGuiNext,
      ctUpdated,
      needConfirm: false,
      notifiedNcc: false,
      message:
        "Đã cập nhật trạng thái trên Sheet. Chưa gửi mail/PDF — cấu hình GAS_SEND_ORDER_URL để uỷ quyền GAS sendOrderFromWebhook.",
    };
  }



  /**
   * Reset đơn hàng (parity V21 resetDuyenHaOrder — áp dụng mọi NCC).
   * Ràng buộc thời gian (business day, Duyên Hà cutoff 14h):
   * - LanGui === 0 (chưa gửi): dayDiff >= 1
   * - LanGui > 0 (đã gửi): dayDiff >= 1 (Duyên Hà) hoặc >= 2 (đơn thường)
   * Full: chưa xe nhận → đổi MaDon + ngày, CT → Mới tạo, LanGui=0
   * Partial: có xe đã nhận → tạo đơn mới, chuyển CT chưa nhận
   */
  static async resetOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    // V21 cancelOrder/reset: admin|purchase — không MANAGER
    const role = String(user.role || "").toUpperCase();
    if (
      !["ADMIN", "PURCHASE"].includes(role) &&
      !hasPermission(user, "ORDER_CANCEL") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Chỉ admin/purchase được reset đơn",
      };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Sheets chưa cấu hình" };
    }
    const y = year ?? currentYearVN();
    const orders = await OrderRepository.findMany({ year: y });
    const order = orders.find(
      (o) => String(o.orderId).toUpperCase() === String(orderId).toUpperCase()
    );
    if (!order) {
      throw { code: "NOT_FOUND", message: `Không tìm thấy đơn ${orderId}` };
    }
    if (String(order.status).toUpperCase() === "CANCEL") {
      throw { code: "INVALID_STATE", message: "Đơn đã hủy, không thể reset." };
    }
    // Phạm vi — parity _canAccessOrder_
    {
      const scope = resolveScope(user);
      const visible = await applyListScopeFilter([order], scope, y);
      if (!visible.length) {
        throw {
          code: "PERMISSION_DENIED",
          message: "Đơn ngoài phạm vi quản lý — không được reset.",
        };
      }
    }

    // 1) Thời gian — parity canResetOrder (chưa gửi ≥1 ngày; đã gửi DHA 1 / khác 2)
    const isDha = isDuyenHaNcc(order.supplierId);
    const sendCount = Number(order.sendCount) || 0;
    const neverSent = sendCount === 0;
    const thresholdDays = neverSent ? 1 : isDha ? 1 : 2;
    const dayDiff = businessDayDiff(order.orderDate, isDha);
    if (dayDiff === null) {
      throw {
        code: "INVALID_STATE",
        message: "Không xác định được ngày đặt hàng.",
      };
    }
    if (dayDiff < thresholdDays) {
      throw {
        code: "TOO_EARLY",
        message: neverSent
          ? `Đơn chưa gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`
          : `Đơn ${isDha ? "Duyên Hà" : "NCC này"} đã gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`,
      };
    }

    const { DetailRepository } = await import(
      "@/repositories/detail.repository"
    );
    const details = (await DetailRepository.findMany({ year: y, orderId })).filter(
      (d) => {
        const st = String(d.status || "").toUpperCase();
        return st !== "DELETE";
      }
    );

    const chuaNhan = details.filter((d) => {
      const st = String(d.status || "").toUpperCase();
      return (Number(d.actualReceived) || 0) === 0 && st !== "CANCEL";
    });
    const daNhanHoacHuy = details.filter(
      (d) => !chuaNhan.some((c) => c.detailId === d.detailId)
    );

    if (!chuaNhan.length) {
      throw {
        code: "INVALID_STATE",
        message: "Tất cả các xe đều đã nhận hoặc đã hủy, không cần reset.",
      };
    }

    // Chốt đủ 2 điều kiện: quá hạn ngày + còn CT chưa nhận
    const fullCheck = canResetOrder({
      status: order.status,
      orderDate: order.orderDate,
      supplierId: order.supplierId,
      sendCount: order.sendCount,
      hasUnreceivedVehicle: true,
    });
    if (!fullCheck.ok) {
      throw {
        code: "TOO_EARLY",
        message: fullCheck.error || "Chưa đủ điều kiện reset đơn.",
      };
    }

    const now = new Date();
    const clock = resolveMaDonClock(order.supplierId, now);
    let newMaDon = generateMaDon(order.supplierId, clock);
    const existing = new Set(orders.map((o) => String(o.orderId)));
    for (let i = 0; i < 30 && existing.has(newMaDon); i++) {
      const d = new Date(clock.getTime() + (i + 1) * 1000);
      newMaDon = generateMaDon(order.supplierId, d);
    }
    if (existing.has(newMaDon)) {
      throw {
        code: "MA_DON_CONFLICT",
        message: "Không tạo được mã đơn mới không trùng.",
      };
    }

    const timeLabel = formatDateTimeVN(new Date());
    const newNgay = todayYmdVN();

    if (daNhanHoacHuy.length === 0) {
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        orderId,
        {
          MaDon: newMaDon,
          NgayDatHang: newNgay,
          LanGui: 0,
          TrangThaiDon: STATUS_DON.NEW,
          ChoGuiMail: true,
          GuiLaimail: false,
          timeGuimail: "",
          FileDonhang: "",
          TongSoChitiet: chuaNhan.length,
          ChitietHuy: 0,
        },
        y
      );
      for (const ct of details) {
        await updateSheetRowByKey(
          SHEETS.CT,
          "ID_Chitiet",
          ct.detailId,
          {
            MaDon: newMaDon,
            NgayDatHang: newNgay,
            TrangThaiXe: STATUS_CT.NEW,
            TimeChange: timeLabel,
          },
          y
        );
      }
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "RESET_ORDER_FULL",
        maDon: newMaDon,
        targetId: orderId,
        oldValue: orderId,
        newValue: newMaDon,
        lyDo: `Reset toàn bộ đơn (dayDiff=${dayDiff}, threshold=${thresholdDays}, LanGui=${sendCount})`,
        year: y,
      });

    // V21: sau reset → _xuLyDonHangNoLock_(newMaDon) gửi ngay (Email/Zalo)
    let sentToNcc = false;
    let sendNote = "";
    {
      const { channel, hinhThucGui } = await resolveNccChannel(order.supplierId);
      if (channel === "app") {
        sendNote = `Hình thức APP (${hinhThucGui || "APP"}) — mở app NCC để đặt đơn mới ${newMaDon}.`;
      } else if (gasWebhookUrl()) {
        const gas = await gasSendOrderFromWebhook(
          newMaDon,
          user.email,
          "send"
        );
        sentToNcc = gas.ok;
        sendNote = gas.ok
          ? `Đã gửi đơn mới ${newMaDon} cho NCC (${channel}).`
          : `Đã tạo ${newMaDon}; gửi NCC thất bại: ${gas.message}`;
      } else {
        sendNote =
          "Đã tạo đơn mới (ChoGuiMail=true) — chưa cấu hình GAS_SEND_ORDER_URL nên chưa gửi NCC.";
      }
    }

      return {
        mode: "full" as const,
        oldMaDon: orderId,
        newMaDon,
        movedDetails: details.length,
        dayDiff,
        threshold: thresholdDays,
        sentToNcc,
        message: `Đã reset đơn: ${orderId} → ${newMaDon}. ${sendNote}`.trim(),
      };
    }

    // Partial
    await appendSheetRow(
      SHEETS.DH,
      {
        MaDon: newMaDon,
        NgayDatHang: newNgay,
        MaNCC: order.supplierId,
        LanGui: 0,
        TrangThaiDon: STATUS_DON.NEW,
        TongSoChitiet: chuaNhan.length,
        ChitietHuy: 0,
        FileDonhang: "",
        ChoGuiMail: true,
        timeGuimail: "",
        GuiLaimail: false,
        User: order.createdBy || user.email,
      },
      y
    );
    for (const ct of chuaNhan) {
      await updateSheetRowByKey(
        SHEETS.CT,
        "ID_Chitiet",
        ct.detailId,
        {
          MaDon: newMaDon,
          NgayDatHang: newNgay,
          TrangThaiXe: STATUS_CT.NEW,
          TimeChange: timeLabel,
        },
        y
      );
    }
    await updateSheetRowByKey(
      SHEETS.DH,
      "MaDon",
      orderId,
      {
        TongSoChitiet: daNhanHoacHuy.length,
        ChoGuiMail: false,
        GuiLaimail: false,
      },
      y
    );

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "RESET_ORDER_PARTIAL",
      maDon: newMaDon,
      targetId: orderId,
      oldValue: orderId,
      newValue: newMaDon,
      lyDo: `Tách ${chuaNhan.length} xe chưa nhận (dayDiff=${dayDiff})`,
      year: y,
    });


    // V21: sau reset → _xuLyDonHangNoLock_(newMaDon) gửi ngay (Email/Zalo)
    let sentToNcc = false;
    let sendNote = "";
    {
      const { channel, hinhThucGui } = await resolveNccChannel(order.supplierId);
      if (channel === "app") {
        sendNote = `Hình thức APP (${hinhThucGui || "APP"}) — mở app NCC để đặt đơn mới ${newMaDon}.`;
      } else if (gasWebhookUrl()) {
        const gas = await gasSendOrderFromWebhook(
          newMaDon,
          user.email,
          "send"
        );
        sentToNcc = gas.ok;
        sendNote = gas.ok
          ? `Đã gửi đơn mới ${newMaDon} cho NCC (${channel}).`
          : `Đã tạo ${newMaDon}; gửi NCC thất bại: ${gas.message}`;
      } else {
        sendNote =
          "Đã tạo đơn mới (ChoGuiMail=true) — chưa cấu hình GAS_SEND_ORDER_URL nên chưa gửi NCC.";
      }
    }

    return {
      mode: "partial" as const,
      oldMaDon: orderId,
      newMaDon,
      movedDetails: chuaNhan.length,
      keptDetails: daNhanHoacHuy.length,
      dayDiff,
      threshold: thresholdDays,
      sentToNcc,
      message: `Đã tách đơn: ${chuaNhan.length} xe → ${newMaDon} (giữ ${orderId}). ${sendNote}`.trim(),
    };
  }

  /** @deprecated alias — dùng resetOrder */
  static async resetDuyenHaOrder(
    orderId: string,
    user: UserContext,
    year?: number
  ) {
    return this.resetOrder(orderId, user, year);
  }

}
