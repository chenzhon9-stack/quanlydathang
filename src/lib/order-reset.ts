/**
 * Điều kiện reset đơn — mở rộng mọi NCC (không chỉ Duyên Hà).
 *
 * Rule (2026-09-30):
 * - Đơn CANCEL → không
 * - Không còn xe chưa nhận → không
 * - Chưa gửi (LanGui = 0): ≥ 1 ngày nghiệp vụ (mọi NCC)
 * - Đã gửi (LanGui > 0): Duyên Hà ≥ 1 ngày; NCC khác ≥ 2 ngày
 *
 * dayDiff = businessTodayKey(isDha) − businessDateKey(NgayDatHang, isDha)
 */

import { businessDateKey, businessTodayKey } from "@/lib/sheets/date";

export function isDuyenHaNcc(maNcc: string): boolean {
  const code = String(maNcc || "").trim().toLowerCase();
  if (code === "dha" || code === "btay") return true;
  // Tên chứa "duyen ha" (không dấu) — phòng MaNCC khác mã
  const fold = code
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
  return fold.includes("duyen ha") || fold.includes("duyenha");
}

/** Số ngày nghiệp vụ giữa ngày đặt và hôm nay (V21 _businessDaysBetween_) */
export function businessDayDiff(
  orderDate: string | number | Date | null | undefined,
  isDha: boolean
): number | null {
  const fromKey = businessDateKey(orderDate, isDha);
  const toKey = businessTodayKey(isDha);
  if (!fromKey || !toKey) return null;
  const toYmd = `${toKey.slice(0, 4)}-${toKey.slice(4, 6)}-${toKey.slice(6, 8)}`;
  const fromYmd = `${fromKey.slice(0, 4)}-${fromKey.slice(4, 6)}-${fromKey.slice(6, 8)}`;
  const t0 = Date.parse(fromYmd + "T00:00:00");
  const t1 = Date.parse(toYmd + "T00:00:00");
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}

export type CanResetInput = {
  status: string;
  orderDate: string;
  supplierId: string;
  sendCount: number;
  /** true nếu còn xe ThucNhan=0 và không Hủy/Xóa; undefined = chưa kiểm tra CT */
  hasUnreceivedVehicle?: boolean;
};

export type CanResetResult = {
  ok: boolean;
  error?: string;
  thresholdDays?: number;
  isDuyenHa?: boolean;
};

/**
 * Kiểm tra điều kiện reset (không gồm quyền user).
 * hasUnreceivedVehicle === false → không reset.
 * hasUnreceivedVehicle === undefined → chỉ check ngày/status (list nhanh — coi như chưa có CT).
 */
export function canResetOrder(input: CanResetInput): CanResetResult {
  const st = String(input.status || "").toUpperCase();
  const statusRaw = String(input.status || "");
  if (
    st === "CANCEL" ||
    statusRaw.includes("Hủy") ||
    statusRaw.includes("HUY")
  ) {
    return { ok: false, error: "Đơn đã hủy, không thể reset." };
  }

  if (input.hasUnreceivedVehicle !== true) {
    return {
      ok: false,
      error: "Tất cả các xe đều đã nhận hoặc đã hủy, không cần reset.",
    };
  }

  const isDha = isDuyenHaNcc(input.supplierId);
  const sendCount = Number(input.sendCount) || 0;
  const neverSent = sendCount === 0;
  // Chưa gửi: mọi NCC ≥ 1 ngày; đã gửi: DHA 1 / khác 2
  const thresholdDays = neverSent ? 1 : isDha ? 1 : 2;
  const dayDiff = businessDayDiff(input.orderDate, isDha);

  if (dayDiff === null) {
    return { ok: false, error: "Không xác định được ngày đặt hàng." };
  }
  if (dayDiff < thresholdDays) {
    const nccLabel = isDha ? "Duyên Hà" : "NCC này";
    return {
      ok: false,
      error: neverSent
        ? `Đơn chưa gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`
        : `Đơn ${nccLabel} đã gửi — cần đợi ít nhất ${thresholdDays} ngày kể từ ngày đặt mới được reset.`,
      thresholdDays,
      isDuyenHa: isDha,
    };
  }

  return { ok: true, thresholdDays, isDuyenHa: isDha };
}
