/**
 * Đồng bộ TrangThaiDon theo các chi tiết — parity V21 syncDetailAndOrder_
 *
 * Rules (V21):
 * - Tất cả CT active (không Hủy/Xóa) = DONE → Đơn DONE
 * - Có ít nhất 1 CT RECEIVED/DELIVERING/DONE → Đang xử lý
 * - Tất cả active = ORDERED/NEW → Khởi tạo (hoặc giữ)
 * - Không còn CT active → Hủy đơn ()
 */
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { STATUS_CT, STATUS_DON } from "@/lib/status";
import { DetailRepository } from "@/repositories/detail.repository";

const TERMINAL_CT = new Set([
  STATUS_CT.CANCEL,
  STATUS_CT.DELETE,
  "Hủy",
  "Hủy xe",
  "Xóa",
  "Xóa xe",
  "CANCEL",
  "DELETE",
]);

const DONE_CT = new Set([
  STATUS_CT.DONE,
  "Hoàn thành",
  "DONE",
]);

const ACTIVE_FLOW = new Set([
  STATUS_CT.RECEIVED,
  STATUS_CT.DELIVERING,
  STATUS_CT.DONE,
  "Đã nhận",
  "Đang giao",
  "Hoàn thành",
  "RECEIVED",
  "DELIVERING",
  "DONE",
]);

function norm(s: string) {
  return String(s || "").trim();
}

export async function syncOrderStatusByOrderId(
  orderId: string,
  year?: number
): Promise<{ orderId: string; status: string; active: number; done: number }> {
  const y = year ?? new Date().getFullYear();
  if (!orderId) {
    return { orderId: "", status: "", active: 0, done: 0 };
  }

  const details = await DetailRepository.findMany({
    year: y,
    orderId,
  });

  const active = details.filter((d) => !TERMINAL_CT.has(norm(d.status)));
  const done = active.filter((d) => DONE_CT.has(norm(d.status)));
  const inFlow = active.filter((d) => ACTIVE_FLOW.has(norm(d.status)));

  let next: string = STATUS_DON.NEW;
  if (active.length === 0) {
    next = STATUS_DON.CANCEL;
  } else if (done.length === active.length && active.length > 0) {
    next = STATUS_DON.DONE;
  } else if (inFlow.length > 0) {
    next = STATUS_DON.PROCESSING;
  } else {
    next = STATUS_DON.PROCESSING; // đã có CT đặt hàng
  }

  await updateSheetRowByKey(
    SHEETS.DH,
    "MaDon",
    orderId,
    { TrangThaiDon: next },
    y
  );

  return {
    orderId,
    status: next,
    active: active.length,
    done: done.length,
  };
}

/** Resolve MaDon từ ID_Chitiet */
export async function syncOrderStatusByDetailId(
  detailId: string,
  year?: number
): Promise<{ orderId: string; status: string } | null> {
  const y = year ?? new Date().getFullYear();
  const details = await DetailRepository.findMany({
    year: y,
  });
  const ct = details.find((d) => d.detailId === detailId);
  if (!ct?.orderId) return null;
  const r = await syncOrderStatusByOrderId(ct.orderId, y);
  return { orderId: r.orderId, status: r.status };
}
