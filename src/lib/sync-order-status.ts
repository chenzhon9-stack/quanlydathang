/**
 * Đồng bộ TrangThaiDon — parity V21 autoUpdateOrderStatus_
 *
 * Rules:
 * - Không còn CT (sau lọc Xóa) → NEW nếu chưa gửi; PROCESSING nếu đã gửi
 * - Tất cả Hủy xe → Hủy đơn
 * - Tất cả DONE hoặc CANCEL (terminal) → Hoàn thành
 * - Tất cả Mới tạo (NEW) → Khởi tạo nếu chưa gửi (LanGui=0, không file/mail); PROCESSING nếu đã gửi
 * - Có ORDERED / RECEIVED / DELIVERING → Đang xử lý
 * - Cập nhật luôn TongSoChitiet, ChitietHuy
 */
import { updateSheetRowByKey, readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { STATUS_CT, STATUS_DON } from "@/lib/status";
import { DetailRepository } from "@/repositories/detail.repository";

function norm(s: string) {
  return String(s || "").trim();
}

function isDelete(st: string) {
  const s = norm(st);
  return (
    s === STATUS_CT.DELETE ||
    s === "DELETE" ||
    s === "Xóa" ||
    s === "Xóa xe"
  );
}

function isCancel(st: string) {
  const s = norm(st);
  return (
    s === STATUS_CT.CANCEL ||
    s === "CANCEL" ||
    s === "Hủy" ||
    s === "Hủy xe"
  );
}

function isNew(st: string) {
  const s = norm(st);
  return (
    s === STATUS_CT.NEW ||
    s === "NEW" ||
    s === "Mới tạo" ||
    s === "Khởi tạo" ||
    s === ""
  );
}

function isDone(st: string) {
  const s = norm(st);
  return s === STATUS_CT.DONE || s === "DONE" || s === "Hoàn thành";
}

function isWorking(st: string) {
  const s = norm(st);
  return (
    s === STATUS_CT.ORDERED ||
    s === STATUS_CT.RECEIVED ||
    s === STATUS_CT.DELIVERING ||
    s === "ORDERED" ||
    s === "RECEIVED" ||
    s === "DELIVERING" ||
    s === "Đặt hàng" ||
    s === "Đã nhận" ||
    s === "Đang giao"
  );
}

/** Đơn đã gửi NCC? (parity _isOrderSentForCancel_ — không dựa TrangThaiDon để tránh sticky sai) */
function isOrderSent(dh: {
  sendCount?: number;
  mailSentAt?: string;
  orderFile?: string;
}): boolean {
  return (
    (Number(dh.sendCount) || 0) > 0 ||
    !!String(dh.mailSentAt || "").trim() ||
    !!String(dh.orderFile || "").trim()
  );
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

  // list = CT không Xóa (V21)
  const list = details.filter((d) => !isDelete(String(d.status || "")));
  const states = list.map((d) => norm(String(d.status || STATUS_CT.NEW)));
  const tong = list.length;
  const huy = list.filter((d) => isCancel(String(d.status || ""))).length;

  // LanGui / file / mail từ DH
  let sent = false;
  try {
    const dhRows = await readSheetAsObjects(SHEETS.DH, { year: y });
    const dh = dhRows.find(
      (r) =>
        String(r.MaDon || r.Ma_Don || "")
          .trim()
          .toUpperCase() === String(orderId).trim().toUpperCase()
    );
    if (dh) {
      sent =
        (Number(dh.LanGui || dh.SoLanGui || 0) || 0) > 0 ||
        !!String(dh.timeGuimail || "").trim() ||
        !!String(dh.FileDonhang || "").trim();
    }
  } catch {
    /* ignore */
  }

  let status: string = STATUS_DON.PROCESSING;

  if (!list.length) {
    status = sent ? STATUS_DON.PROCESSING : STATUS_DON.NEW;
  } else {
    const allCancel = states.every((s) => isCancel(s));
    const allNew = states.every((s) => isNew(s));
    const allTerminal = states.every((s) => isDone(s) || isCancel(s));
    const hasWorking = states.some((s) => isWorking(s));

    if (allCancel) status = STATUS_DON.CANCEL;
    else if (allTerminal) status = STATUS_DON.DONE;
    else if (allNew) status = sent ? STATUS_DON.PROCESSING : STATUS_DON.NEW;
    else if (hasWorking) status = STATUS_DON.PROCESSING;
    else status = STATUS_DON.PROCESSING;
  }

  await updateSheetRowByKey(
    SHEETS.DH,
    "MaDon",
    orderId,
    {
      TrangThaiDon: status,
      TongSoChitiet: tong,
      ChitietHuy: huy,
    },
    y
  );

  return {
    orderId,
    status,
    active: tong - huy,
    done: list.filter((d) => isDone(String(d.status || ""))).length,
  };
}

/** Resolve MaDon từ ID_Chitiet */
export async function syncOrderStatusByDetailId(
  detailId: string,
  year?: number
): Promise<{ orderId: string; status: string } | null> {
  const y = year ?? new Date().getFullYear();
  const details = await DetailRepository.findMany({ year: y });
  const ct = details.find((d) => d.detailId === detailId);
  if (!ct?.orderId) return null;
  const r = await syncOrderStatusByOrderId(ct.orderId, y);
  return { orderId: r.orderId, status: r.status };
}
