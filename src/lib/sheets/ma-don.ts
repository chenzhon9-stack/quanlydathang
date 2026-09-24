/**
 * generateMaDon — parity V21 generateMaDon_ / _generateUniqueMaDon_
 *
 * Format: No.{2 ký tự đầu MaNCC}{YYMMDD}-{HHmmss}
 * Ví dụ: No.SL260924-083512
 *
 * Duyên Hà / btay (IsDuyenHa NCC):
 * - ≥ 14h: ngày +1, giờ = giờ − 14
 * - < 14h: giữ ngày, giờ = giờ + 10
 */

import { hcmDateTimeParts, hourVN, parseLocalDate } from "@/lib/sheets/date";
import { OrderRepository } from "@/repositories/order.repository";

const DUYEN_HA_NCC = new Set(["dha", "btay"]);

function isDuyenHaNcc(maNcc: string): boolean {
  return DUYEN_HA_NCC.has(String(maNcc || "").trim().toLowerCase());
}

/**
 * Tính Date dùng cho phần YYMMDD-HHmmss theo rule Duyên Hà.
 */
export function resolveMaDonClock(
  maNcc: string,
  ngayDatHang: string | number | Date
): Date {
  const base = parseLocalDate(ngayDatHang) || new Date();
  if (!isDuyenHaNcc(maNcc)) return base;

  // Lấy giờ HCM từ base (nếu chỉ có date 00:00, dùng giờ hiện tại)
  const hasTime =
    ngayDatHang instanceof Date ||
    (typeof ngayDatHang === "string" && /\d{1,2}:\d{2}/.test(ngayDatHang));
  const hour = hasTime ? hourVN(base) : hourVN(new Date());

  // Xây Date local từ YMD của base + hour logic V21
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const mi = base.getMinutes();
  const ss = base.getSeconds();

  if (hour >= 14) {
    // ngày +1, giờ = hour - 14
    const next = new Date(y, m, d + 1, hour - 14, mi, ss, 0);
    return next;
  }
  // giữ ngày, giờ = hour + 10
  return new Date(y, m, d, hour + 10, mi, ss, 0);
}

/** Sinh 1 mã (có thể trùng — caller dùng generateUniqueMaDon) */
export function generateMaDon(
  maNcc: string,
  ngayDatHang: string | number | Date
): string {
  const ncc = String(maNcc || "").trim();
  const prefix = "No." + ncc.substring(0, 2).toUpperCase();
  const clock = resolveMaDonClock(ncc, ngayDatHang);
  const p = hcmDateTimeParts(clock);
  return `${prefix}${p.yy}${p.mm}${p.dd}-${p.hh}${p.mi}${p.ss}`;
}

/**
 * Sinh mã không trùng trong DonHang (thử +1s tối đa 60 lần).
 */
export async function generateUniqueMaDon(
  maNcc: string,
  ngayDatHang: string | number | Date,
  opts?: { year?: number; oldMaDon?: string }
): Promise<{ maDon: string; date: Date }> {
  const base = parseLocalDate(ngayDatHang) || new Date();
  const year = opts?.year ?? base.getFullYear();
  const oldSafe = String(opts?.oldMaDon || "").trim();

  // Load existing MaDon set
  const existing = new Set<string>();
  try {
    const orders = await OrderRepository.findMany({ year });
    for (const o of orders) {
      if (o.orderId) existing.add(String(o.orderId).trim());
    }
  } catch {
    // nếu repo fail, vẫn thử generate
  }

  for (let i = 0; i < 60; i++) {
    const d = new Date(base.getTime() + i * 1000);
    const ma = generateMaDon(maNcc, d);
    if (ma === oldSafe) continue;
    if (!existing.has(ma)) return { maDon: ma, date: d };
  }
  throw new Error(
    "Không tạo được mã đơn mới không trùng. Vui lòng thử lại sau."
  );
}
