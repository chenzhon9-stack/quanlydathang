/**
 * Chuẩn hóa ngày tháng — parity V21
 * (_parseLocalDate_, _ymdDate, _ymdLocal_, _dateStartOfDay_, _dateEndOfDay_,
 *  _counterDateKey_, business date Duyên Hà)
 *
 * Quy ước:
 * - API / form / state: luôn `yyyy-MM-dd` (local VN, không dùng toISOString slice)
 * - Sheet serial: days from 1899-12-30 (Sheets civil)
 * - Hiển thị VN: `dd/MM/yyyy`
 * - Điểm ngày (NgayNhan, Ngaygiao, TuNgay, NgayCT): 00:00:00 local
 * - Biên inclusive DenNgay: 23:59:59.999 local
 */

const TZ = "Asia/Ho_Chi_Minh";

/** YYYY-MM-DD theo timezone HCM từ Date */
export function ymdInTz(d: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** yyMMdd theo HCM — key counter */
export function counterDateKey(dateValue?: string | number | Date | null): string {
  const d = parseLocalDate(dateValue) || new Date();
  const ymd = ymdInTz(d);
  return ymd.slice(2, 4) + ymd.slice(5, 7) + ymd.slice(8, 10); // yyMMdd
}

/**
 * Parse mọi dạng Sheet/form → Date local (components HCM khi có thể).
 * Hỗ trợ: Date, serial Sheets, yyyy-MM-dd, dd/MM/yyyy, ISO, yyyyMMdd.
 */
export function parseLocalDate(
  value: string | number | Date | null | undefined
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Serial Sheets
  if (
    typeof value === "number" ||
    (/^\d+(\.\d+)?$/.test(String(value).trim()) && Number(value) > 20000)
  ) {
    const serial = Math.floor(Number(value));
    const epoch = Date.UTC(1899, 11, 30);
    const utc = new Date(epoch + serial * 86400000);
    // Construct local-like date from UTC YMD of serial
    return new Date(
      utc.getUTCFullYear(),
      utc.getUTCMonth(),
      utc.getUTCDate(),
      0,
      0,
      0,
      0
    );
  }

  const s = String(value).trim();

  // yyyyMMdd
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
  }

  // yyyy-MM-dd or yyyy-MM-ddTHH:mm...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const hh = Number(iso[4] || 0);
    const mi = Number(iso[5] || 0);
    const ss = Number(iso[6] || 0);
    return new Date(y, m - 1, d, hh, mi, ss, 0);
  }

  // DD/MM/YYYY or MM/DD/YYYY (+ optional time)
  const m1 = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (m1) {
    const a = Number(m1[1]);
    const b = Number(m1[2]);
    const yyyy = Number(m1[3]);
    let dd: number;
    let mm: number;
    if (a > 12 && b <= 12) {
      dd = a;
      mm = b;
    } else if (b > 12 && a <= 12) {
      mm = a;
      dd = b;
    } else {
      // VN default DD/MM
      dd = a;
      mm = b;
    }
    const hh = Number(m1[4] || 0);
    const mi = Number(m1[5] || 0);
    const ss = Number(m1[6] || 0);
    return new Date(yyyy, mm - 1, dd, hh, mi, ss, 0);
  }

  // DD/MM/YY
  const m2 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m2) {
    const yyyy = Number(m2[3]) > 50 ? 1900 + Number(m2[3]) : 2000 + Number(m2[3]);
    return new Date(yyyy, Number(m2[2]) - 1, Number(m2[1]), 0, 0, 0, 0);
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

/** Alias V21 _ymdDate / _ymdLocal_ / _rawDateYmd_ */
export function ymdDate(
  value: string | number | Date | null | undefined
): string {
  const d = parseLocalDate(value);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Load từ Sheet → yyyy-MM-dd (giữ tên cũ cho mapper) */
export function normalizeSheetDate(
  raw: string | number | undefined | null
): string {
  return ymdDate(raw);
}

/** Ghi xuống Sheet / API: luôn yyyy-MM-dd */
export function toSheetDate(
  value: string | number | Date | null | undefined
): string {
  return ymdDate(value);
}

/** Hiển thị dd/MM/yyyy */
export function fmtDateVN(
  value: string | number | Date | null | undefined
): string {
  const ymd = ymdDate(value);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** Đầu ngày local 00:00:00.000 */
export function dateStartOfDay(
  value: string | number | Date | null | undefined
): Date | null {
  const ymd = ymdDate(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Cuối ngày local 23:59:59.999 */
export function dateEndOfDay(
  value: string | number | Date | null | undefined
): Date | null {
  const ymd = ymdDate(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function yearOfDate(isoOrRaw: string): number | null {
  const iso = ymdDate(isoOrRaw);
  if (/^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
  return null;
}

/** Today HCM yyyy-MM-dd */
export function todayYmdVN(d = new Date()): string {
  return ymdInTz(d);
}

/** Giờ 0–23 HCM */
export function hourVN(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

/**
 * Business date key yyyyMMdd — Duyên Hà cutoff 14h.
 * isDuyenHa + giờ ≥ 14 → ngày +1.
 */
export function businessDateKey(
  value: string | number | Date | null | undefined,
  isDuyenHa: boolean
): string {
  const d = parseLocalDate(value) || new Date();
  let ymd = ymdDate(d);
  if (isDuyenHa) {
    const h =
      value instanceof Date || typeof value === "object"
        ? hourVN(d)
        : hourVN(d);
    // If only date string without time, use current hour when value is "now"
    const hasTime =
      value instanceof Date ||
      (typeof value === "string" && /\d{1,2}:\d{2}/.test(value));
    const hour = hasTime ? hourVN(d) : hourVN(new Date());
    if (hour >= 14) {
      const next = dateStartOfDay(ymd)!;
      next.setDate(next.getDate() + 1);
      ymd = ymdDate(next);
    }
  }
  return ymd.replace(/-/g, "");
}

/** Parts HCM for MaDon timestamp */
export function hcmDateTimeParts(d = new Date()): {
  yy: string;
  mm: string;
  dd: string;
  hh: string;
  mi: string;
  ss: string;
  ymd: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  );
  const ymd = ymdInTz(d);
  return {
    yy: parts.year || ymd.slice(2, 4),
    mm: parts.month || ymd.slice(5, 7),
    dd: parts.day || ymd.slice(8, 10),
    hh: (parts.hour || "00").padStart(2, "0"),
    mi: (parts.minute || "00").padStart(2, "0"),
    ss: (parts.second || "00").padStart(2, "0"),
    ymd,
  };
}
