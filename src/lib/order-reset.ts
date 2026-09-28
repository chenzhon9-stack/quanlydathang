/**
 * Điều kiện reset đơn — parity V21 _canResetDuyenHaOrder_
 *
 * - Đơn đã Hủy → không
 * - isDha (MaNCC dha|btay): threshold = 1 ngày nghiệp vụ
 * - Đơn thường: threshold = 2 ngày nghiệp vụ
 * - LanGui === 0 (chưa gửi): cần dayDiff >= 1
 * - LanGui > 0 (đã gửi): cần dayDiff >= threshold
 * - Phải còn ít nhất 1 xe chưa nhận (ThucNhan=0 và không Hủy)
 *
 * dayDiff = businessTodayKey(isDha) − businessDateKey(NgayDatHang, isDha)
 */

import { businessDateKey, businessTodayKey } from "@/lib/sheets/date";

export function isDuyenHaNcc(maNcc: string): boolean {
  const code = String(maNcc || "").trim().toLowerCase();
  return code === "dha" || code === "btay";
}

/** Số ngày nghiệp vụ giữa ngày đặt và hôm nay (V21 _businessDaysBetween_) */
export function businessDayDiff(
  orderDate: string | number | Date | null | undefined,
  isDha: boolean
): number | null {
  const fromKey = businessDateKey(orderDate, isDha);
  const toKey = businessTodayKey(isDha);
  if (!fromKey || !toKey) return null;
  // keys: YYYYMMDD
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

/**
 * Kiểm tra điều kiện reset (không gồm quyền user).
 * hasUnreceivedVehicle === false → không reset.
 * hasUnreceivedVehicle === undefined → chỉ check ngày/status (dùng cho UI list nhanh).
 */
export function canResetOrder(input: CanResetInput): { ok: boolean; error?: string } {
  const st = String(input.status || "").toUpperCase();
  if (st === "CANCEL" || st.includes("HỦY") || st.includes("HUY")) {
    return { ok: false, error: "Đơn đã hủy, không thể reset." };
  }

  const isDha = isDuyenHaNcc(input.supplierId);
  const threshold = isDha ? 1 : 2;
  const dayDiff = businessDayDiff(input.orderDate, isDha);
  const lanGui = Number(input.sendCount) || 0;

  // V21: (slan>0 && dayDiff < threshold) || (slan===0 && dayDiff < 1)
  if (
    dayDiff === null ||
    (lanGui > 0 && dayDiff < threshold) ||
    (lanGui === 0 && dayDiff < 1)
  ) {
    return {
      ok: false,
      error: isDha
        ? "Chỉ được reset đơn Duyên Hà sau 1 ngày kể từ ngày đặt."
        : "Chỉ được reset đơn sau 2 ngày kể từ ngày đặt.",
    };
  }

  // Bắt buộc còn xe chưa nhận — không truyền / false → không cho reset
  if (input.hasUnreceivedVehicle !== true) {
    return {
      ok: false,
      error: "Tất cả các xe đều đã nhận hoặc đã hủy, không cần reset.",
    };
  }

  return { ok: true };
}
