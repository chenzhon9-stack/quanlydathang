/**
 * Chuẩn hóa ngày tháng — parity V21
 * (_parseLocalDate_, _ymdDate, _ymdLocal_, _dateStartOfDay_, _dateEndOfDay_,
 *  _counterDateKey_, _businessDateKey_, Duyên Hà 14h)
 *
 * Quy ước (khớp GAS Asia/Ho_Chi_Minh):
 * - API / form / state: luôn `yyyy-MM-dd` — KHÔNG dùng toISOString().slice(0,10)
 * - Sheet serial: days from 1899-12-30
 * - Hiển thị VN: `dd/MM/yyyy`
 * - Điểm ngày (NgayNhan, Ngaygiao, TuNgay, NgayCT): 00:00:00 HCM
 * - Biên inclusive DenNgay: 23:59:59.999 HCM
 * - Mọi “hôm nay / năm hiện tại” lấy theo HCM, không theo UTC server Vercel
 */

const TZ = "Asia/Ho_Chi_Minh";

/** YYYY-MM-DD theo timezone HCM từ Date thật (wall-clock VN) */
export function ymdInTz(d: Date, timeZone = TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Hôm nay yyyy-MM-dd (HCM) — parity _defaultToDate_ / today */
export function todayYmdVN(d = new Date()): string {
  return ymdInTz(d);
}

/** Năm lịch hiện tại theo HCM */
export function currentYearVN(d = new Date()): number {
  return Number(ymdInTz(d).slice(0, 4));
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

/** Cộng/trừ ngày trên chuỗi yyyy-MM-dd (civil), không qua UTC shift */
export function addDaysYmd(ymd: string, delta: number): string {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Dùng UTC noon tránh DST edge khi chỉ cộng civil day
  const dt = new Date(Date.UTC(y, mo - 1, d + delta, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Parse mọi dạng Sheet/form → Date.
 * Chuỗi thuần yyyy-MM-dd / dd/MM/yyyy → 00:00:00 theo **UTC** với đúng Y-M-D
 * (tránh phụ thuộc timezone process), rồi ymdDate luôn lấy calendar từ components.
 * Date “thật” (now) → giữ epoch; format ra HCM bằng ymdInTz.
 */
export function parseLocalDate(
  value: string | number | Date | null | undefined
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  // Serial Sheets
  if (
    typeof value === "number" ||
    (/^\d+(\.\d+)?$/.test(String(value).trim()) && Number(value) > 20000)
  ) {
    const serial = Math.floor(Number(value));
    const epoch = Date.UTC(1899, 11, 30);
    const utc = new Date(epoch + serial * 86400000);
    return new Date(
      Date.UTC(
        utc.getUTCFullYear(),
        utc.getUTCMonth(),
        utc.getUTCDate(),
        0,
        0,
        0,
        0
      )
    );
  }

  const s = String(value).trim();

  // yyyyMMdd
  if (/^\d{8}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    }
  }

  // yyyy-MM-dd[THH:mm:ss] — local civil như V21 (không parse UTC Z)
  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const hh = Number(iso[4] || 0);
    const mi = Number(iso[5] || 0);
    const ss = Number(iso[6] || 0);
    // Lưu dưới dạng UTC components = civil date (giống “local” GAS trên server UTC)
    return new Date(Date.UTC(y, m - 1, d, hh, mi, ss, 0));
  }

  // DD/MM/YYYY — ưu tiên VN
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
      dd = a;
      mm = b;
    }
    const hh = Number(m1[4] || 0);
    const mi = Number(m1[5] || 0);
    const ss = Number(m1[6] || 0);
    return new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss, 0));
  }

  // DD/MM/YY
  const m2 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m2) {
    const yyyy =
      Number(m2[3]) > 50 ? 1900 + Number(m2[3]) : 2000 + Number(m2[3]);
    return new Date(
      Date.UTC(yyyy, Number(m2[2]) - 1, Number(m2[1]), 0, 0, 0, 0)
    );
  }

  // ISO có Z / offset → lấy wall-clock HCM
  if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

/**
 * V21 _ymdDate / _ymdLocal_ / _rawDateYmd_
 * - Chuỗi/serial civil → yyyy-MM-dd từ UTC components (đã parse civil)
 * - Date “live” (now, Instant có Z) → format theo Asia/Ho_Chi_Minh
 */
export function ymdDate(
  value: string | number | Date | null | undefined
): string {
  if (value === null || value === undefined || value === "") return "";

  // Fast path: already yyyy-MM-dd
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const d = parseLocalDate(value);
  if (!d) return "";

  // Live timestamps (instanceof Date input or ISO with zone) → HCM wall clock
  if (
    value instanceof Date ||
    (typeof value === "string" &&
      (/Z$|[+-]\d{2}:\d{2}$/.test(value.trim()) || /T/.test(value)))
  ) {
    // Nếu chuỗi yyyy-MM-ddTHH:mm không có Z đã parse civil UTC → lấy UTC YMD
    if (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}[T\s]/.test(value.trim()) &&
      !/Z$|[+-]\d{2}:\d{2}$/.test(value.trim())
    ) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    return ymdInTz(d);
  }

  // Serial / yyyyMMdd / dd/MM/yyyy đã gắn UTC civil
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Load từ Sheet → yyyy-MM-dd */
export function normalizeSheetDate(
  raw: string | number | Date | null | undefined
): string {
  return ymdDate(raw);
}

/** Ghi Sheet / API — luôn yyyy-MM-dd */
export function toSheetDate(
  value: string | number | Date | null | undefined
): string {
  return ymdDate(value);
}

/** Hiển thị dd/MM/yyyy — parity _fmtDate */
export function formatDateVN(
  value: string | number | Date | null | undefined
): string {
  const ymd = ymdDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * DateTime ghi Audit/TimeChange — parity Utilities.formatDate HCM
 * `yyyy-MM-dd HH:mm:ss` (không dùng toISOString UTC)
 */
export function formatDateTimeVN(d = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Đầu ngày civil 00:00:00.000 (UTC components = calendar) */
export function dateStartOfDay(
  value: string | number | Date | null | undefined
): Date | null {
  const ymd = ymdDate(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/** Cuối ngày civil 23:59:59.999 */
export function dateEndOfDay(
  value: string | number | Date | null | undefined
): Date | null {
  const ymd = ymdDate(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

export function yearOfDate(isoOrRaw: string): number | null {
  const iso = ymdDate(isoOrRaw);
  if (/^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
  return null;
}

/** yyMMdd HCM — V21 _counterDateKey_ */
export function counterDateKey(
  dateValue?: string | number | Date | null
): string {
  const ymd =
    dateValue === null || dateValue === undefined || dateValue === ""
      ? todayYmdVN()
      : ymdDate(dateValue) || todayYmdVN();
  return ymd.slice(2, 4) + ymd.slice(5, 7) + ymd.slice(8, 10);
}

/**
 * Business date key yyyyMMdd — V21 _businessDateKey_
 * isDuyenHa + giờ ≥ 14 (HCM) → ngày +1
 */
export function businessDateKey(
  value: string | number | Date | null | undefined,
  isDuyenHa: boolean
): string {
  let ymd =
    value === null || value === undefined || value === ""
      ? todayYmdVN()
      : ymdDate(value) || todayYmdVN();

  if (isDuyenHa) {
    const hasTime =
      value instanceof Date ||
      (typeof value === "string" && /\d{1,2}:\d{2}/.test(value));
    const hour = hasTime
      ? value instanceof Date
        ? hourVN(value)
        : hourVN(parseLocalDate(value) || new Date())
      : hourVN(new Date());
    if (hour >= 14) {
      ymd = addDaysYmd(ymd, 1);
    }
  }
  return ymd.replace(/-/g, "");
}

export function businessTodayKey(isDuyenHa: boolean): string {
  return businessDateKey(new Date(), isDuyenHa);
}

/** Parts HCM cho MaDon timestamp */
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
