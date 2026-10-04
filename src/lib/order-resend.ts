/**
 * Bật GuiLaimail khi đơn đã gửi NCC và dữ liệu quan trọng thay đổi.
 * Parity V21: _markOrderChoGuiMailIfSent_ / _updateDetailAndMarkResend_ / _markResendByPlanQtyChange_
 */
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { writeAudit } from "@/lib/sheets/audit";
import { STATUS_DON } from "@/lib/status";
import type { Order } from "@/types";

export function isOrderSentLike(order: {
  status?: string;
  sendCount?: number;
  pendingMail?: boolean;
  resendMail?: boolean;
  mailSentAt?: string | null;
  sentAt?: string | null;
  timeGuimail?: string | null;
}): boolean {
  const st = String(order.status || "").trim().toUpperCase();
  const lan = Number(order.sendCount) || 0;
  if (lan > 0) return true;
  if (order.pendingMail || order.resendMail) return true;
  if (order.mailSentAt || order.sentAt || order.timeGuimail) return true;
  if (
    st === "PROCESSING" ||
    st === "DONE" ||
    st === "ĐANG XỬ LÝ" ||
    st === "HOÀN THÀNH"
  ) {
    return true;
  }
  return false;
}

export function numClose(a: unknown, b: unknown, eps = 0.0001): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
}

export function textDiff(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim() !== String(b ?? "").trim();
}

/**
 * Nếu đơn đã gửi → GuiLaimail=true, TrangThaiDon=Đang xử lý + audit.
 */
export async function markOrderResendIfSent(opts: {
  orderId: string;
  order?: Order | null;
  email: string;
  role?: string;
  action: string;
  changedFields: string[];
  oldValue?: unknown;
  newValue?: unknown;
  year?: number;
}): Promise<{ marked: boolean; reason?: string; changedFields: string[] }> {
  const changedFields = (opts.changedFields || []).filter(Boolean);
  if (!opts.orderId || !changedFields.length) {
    return { marked: false, reason: "NO_CHANGE", changedFields: [] };
  }

  if (!opts.order) {
    return { marked: false, reason: "NO_ORDER", changedFields };
  }

  if (!isOrderSentLike(opts.order)) {
    return { marked: false, reason: "ORDER_NOT_SENT", changedFields };
  }

  const y = opts.year;
  await updateSheetRowByKey(
    SHEETS.DH,
    "MaDon",
    opts.orderId,
    {
      GuiLaimail: true,
      TrangThaiDon: STATUS_DON.PROCESSING,
    },
    y
  );

  await writeAudit({
    email: opts.email,
    role: opts.role || "",
    action: opts.action || "MARK_RESEND_NCC",
    maDon: opts.orderId,
    targetId: opts.orderId,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    lyDo: "Bật GuiLaimail do thay đổi: " + changedFields.join(", "),
    year: y,
  }).catch(() => null);

  return { marked: true, changedFields };
}

/** So sánh field CT quan trọng (V21 _updateDetailAndMarkResend_). */
export function diffDetailMasterFields(
  oldCt: {
    vehicleId?: string;
    productId?: string;
    regionId?: string;
    note?: string;
    quantity?: number;
  },
  newData: {
    vehicleId?: string;
    productId?: string;
    regionId?: string;
    note?: string;
    quantity?: number;
    hasQuantity?: boolean;
  }
): string[] {
  const changed: string[] = [];
  if (
    newData.vehicleId !== undefined &&
    textDiff(oldCt.vehicleId, newData.vehicleId)
  ) {
    changed.push("Mã xe");
  }
  if (
    newData.productId !== undefined &&
    textDiff(oldCt.productId, newData.productId)
  ) {
    changed.push("Mã hàng hóa");
  }
  if (
    newData.regionId !== undefined &&
    textDiff(oldCt.regionId, newData.regionId)
  ) {
    changed.push("Khu vực");
  }
  if (newData.note !== undefined && textDiff(oldCt.note, newData.note)) {
    changed.push("Ghi chú");
  }
  if (
    (newData.hasQuantity || newData.quantity !== undefined) &&
    !numClose(oldCt.quantity, newData.quantity)
  ) {
    changed.push("Số lượng kế hoạch");
  }
  return changed;
}
