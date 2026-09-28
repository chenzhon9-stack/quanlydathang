/**
 * generateMaDon — parity V21 generateMaDon_ / _generateUniqueMaDon_
 *
 * Format: No.{2 ký tự đầu MaNCC}{YYMMDD}-{HHmmss}
 *
 * Thời gian lấy từ **Ngày đặt hàng** (user chỉnh được), KHÔNG dùng giờ server.
 *
 * Duyên Hà / btay (MaNCC):
 * - ≥ 14h: ngày +1, giờ = giờ − 14
 * - < 14h: giữ ngày, giờ = giờ + 10
 */

import { parseLocalDate } from "@/lib/sheets/date";
import { OrderRepository } from "@/repositories/order.repository";

const DUYEN_HA_NCC = new Set(["dha", "btay"]);

function isDuyenHaNcc(maNcc: string): boolean {
  return DUYEN_HA_NCC.has(String(maNcc || "").trim().toLowerCase());
}

type Civil = {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
  hasTime: boolean;
};

/** Trích ngày-giờ civil từ Ngày đặt hàng (không lệch timezone server). */
function extractCivil(value: string | number | Date | null | undefined): Civil {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      y: value.getUTCFullYear(),
      m: value.getUTCMonth() + 1,
      d: value.getUTCDate(),
      hh: value.getUTCHours(),
      mi: value.getUTCMinutes(),
      ss: value.getUTCSeconds(),
      hasTime: true,
    };
  }

  const s = String(value ?? "").trim();
  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (iso) {
    return {
      y: Number(iso[1]),
      m: Number(iso[2]),
      d: Number(iso[3]),
      hh: iso[4] != null ? Number(iso[4]) : 0,
      mi: iso[5] != null ? Number(iso[5]) : 0,
      ss: iso[6] != null ? Number(iso[6]) : 0,
      hasTime: iso[4] != null,
    };
  }

  const parsed = parseLocalDate(value);
  if (parsed) {
    return {
      y: parsed.getUTCFullYear(),
      m: parsed.getUTCMonth() + 1,
      d: parsed.getUTCDate(),
      hh: parsed.getUTCHours(),
      mi: parsed.getUTCMinutes(),
      ss: parsed.getUTCSeconds(),
      hasTime: parsed.getUTCHours() !== 0 || parsed.getUTCMinutes() !== 0,
    };
  }

  const now = new Date();
  return {
    y: now.getUTCFullYear(),
    m: now.getUTCMonth() + 1,
    d: now.getUTCDate(),
    hh: 0,
    mi: 0,
    ss: 0,
    hasTime: false,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function civilToUtcDate(c: Civil): Date {
  return new Date(Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mi, c.ss, 0));
}

/**
 * Áp dụng rule Duyên Hà trên civil datetime của Ngày đặt hàng.
 * Không dùng giờ hiện tại server.
 */
export function resolveMaDonClock(
  maNcc: string,
  ngayDatHang: string | number | Date
): Date {
  const c = extractCivil(ngayDatHang);
  if (!isDuyenHaNcc(maNcc)) {
    return civilToUtcDate(c);
  }

  const hour = c.hh;
  if (hour >= 14) {
    const next = civilToUtcDate({ ...c, hh: hour - 14 });
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  return civilToUtcDate({ ...c, hh: hour + 10 });
}

function formatStamp(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function generateMaDon(
  maNcc: string,
  ngayDatHang: string | number | Date
): string {
  const ncc = String(maNcc || "").trim();
  const prefix = "No." + ncc.substring(0, 2).toUpperCase();
  const clock = resolveMaDonClock(ncc, ngayDatHang);
  return `${prefix}${formatStamp(clock)}`;
}

export async function generateUniqueMaDon(
  maNcc: string,
  ngayDatHang: string | number | Date,
  opts?: { year?: number; oldMaDon?: string }
): Promise<{ maDon: string; date: Date }> {
  const baseClock = resolveMaDonClock(maNcc, ngayDatHang);
  const year = opts?.year ?? extractCivil(ngayDatHang).y;
  const oldSafe = String(opts?.oldMaDon || "").trim();

  const existing = new Set<string>();
  try {
    const orders = await OrderRepository.findMany({ year });
    for (const o of orders) {
      if (o.orderId) existing.add(String(o.orderId).trim());
    }
  } catch {
    /* ignore */
  }

  const ncc = String(maNcc || "").trim();
  const prefix = "No." + ncc.substring(0, 2).toUpperCase();

  for (let i = 0; i < 60; i++) {
    const d = new Date(baseClock.getTime() + i * 1000);
    // Không gọi generateMaDon lại (tránh áp rule DHA lần 2)
    const ma = `${prefix}${formatStamp(d)}`;
    if (ma === oldSafe) continue;
    if (!existing.has(ma)) return { maDon: ma, date: d };
  }
  throw new Error(
    "Không tạo được mã đơn mới không trùng. Vui lòng thử lại sau."
  );
}
