/**
 * Business rules ported from V21
 * - qty3, chia hết (TyleChiahet)
 * - hao hụt (TyleHaohut)
 * - ngày nhận / ngày giao (+ Duyên Hà cutoff 14h)
 */

export const EPS = 1e-9;

/** Làm tròn 3 chữ số thập phân (tấn) — V21 qty3 */
export function qty3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * Thực nhận / thực giao phải chia hết cho TyleChiahet.
 * step <= 0 → bỏ qua (không ràng buộc).
 * V21: |value/step − round(value/step)| < 1e-9
 */
export function validateStep(value: number, step: number): boolean {
  // V21 _validateStep_: step<=0 → true; |value/step − round| < 1e-9
  // qty3 trước khi chia để tránh lỗi float (0.30000000004 tấn)
  const s = Number(step) || 0;
  if (s <= EPS) return true;
  const v = qty3(Number(value) || 0);
  if (Math.abs(v) < EPS) return true; // 0 luôn chia hết
  const ratio = v / s;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** Làm tròn value về bội của step (qty3) */
export function roundToStep(value: number, step: number): number {
  const s = Number(step) || 0;
  if (s <= EPS) return qty3(value);
  return qty3(Math.round(value / s) * s);
}

/**
 * Hao hụt: |TN − TG| / TN ≤ tlHH
 * tlHH trên sheet thường là tỷ lệ (0.02 = 2%). Nếu > 1 coi là % → /100.
 */
export function normalizeHaohut(raw: number): number {
  const n = Number(raw) || 0;
  if (n > 1) return n / 100;
  return Math.max(0, n);
}

export function validateTolerance(
  thucNhan: number,
  tongGiao: number,
  tlHHRaw: number
): boolean {
  const tn = Number(thucNhan) || 0;
  const tg = Number(tongGiao) || 0;
  if (!(tn > 0)) return Math.abs(tg) < EPS;
  const tl = normalizeHaohut(tlHHRaw);
  return Math.abs(tn - tg) / tn <= tl + EPS;
}

/** YYYY-MM-DD so sánh chuỗi */
export function ymdCompare(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

/** Ngày VN hiện tại YYYY-MM-DD */
export function todayYmdVN(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Giờ VN 0–23 */
export function hourVN(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

/** Cộng N ngày vào YYYY-MM-DD */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Business today key (V21 _businessTodayKey_).
 * Duyên Hà: sau 14h → ngày nghiệp vụ = ngày mai.
 */
export function businessTodayKey(isDuyenHa?: boolean, now = new Date()): string {
  let key = todayYmdVN(now);
  if (isDuyenHa && hourVN(now) >= 14) {
    key = addDaysYmd(key, 1);
  }
  return key;
}

/**
 * Validate ngày nhận — V21 _validateReceiveDate_
 * - bắt buộc
 * - >= ngày đặt
 * - <= business today (Duyên Hà sau 14h = tomorrow)
 */

/** min/max cho <input type="date"> — ngày nhận */
export function receiveDateBounds(opts: {
  orderDate?: string;
  isDuyenHa?: boolean;
}): { min?: string; max: string } {
  const min = (opts.orderDate || "").slice(0, 10) || undefined;
  const max = businessTodayKey(!!opts.isDuyenHa);
  return { min: min && /^\d{4}-\d{2}-\d{2}$/.test(min) ? min : undefined, max };
}

/** min/max cho <input type="date"> — ngày giao */
export function deliveryDateBounds(opts: {
  receivedDate?: string;
  isDuyenHa?: boolean;
}): { min?: string; max: string } {
  const min = (opts.receivedDate || "").slice(0, 10) || undefined;
  const max = businessTodayKey(!!opts.isDuyenHa);
  return { min: min && /^\d{4}-\d{2}-\d{2}$/.test(min) ? min : undefined, max };
}

/** Kẹp yyyy-MM-dd vào [min, max] */
export function clampYmd(value: string, min?: string, max?: string): string {
  let x = (value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  if (min && /^\d{4}-\d{2}-\d{2}$/.test(min) && x < min) x = min;
  if (max && /^\d{4}-\d{2}-\d{2}$/.test(max) && x > max) x = max;
  return x;
}

export function validateReceiveDate(opts: {
  orderDate?: string;
  receivedDate: string;
  isDuyenHa?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const ngay = (opts.receivedDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) {
    return { ok: false, error: "Vui lòng chọn ngày nhận hàng (YYYY-MM-DD)." };
  }
  const order = (opts.orderDate || "").slice(0, 10);
  if (order && ymdCompare(ngay, order) < 0) {
    return {
      ok: false,
      error:
        `Ngày nhận hàng không được nhỏ hơn ngày đặt hàng.\n` +
        `Ngày đặt: ${order}\nNgày nhận: ${ngay}` +
        (opts.isDuyenHa ? "\nDuyên Hà: sau 14h được tính sang ngày hôm sau." : ""),
    };
  }
  const maxDay = businessTodayKey(!!opts.isDuyenHa);
  if (ymdCompare(ngay, maxDay) > 0) {
    return {
      ok: false,
      error:
        `Ngày nhận hàng không được lớn hơn ngày hôm nay.\n` +
        `Hôm nay hợp lệ: ${maxDay}` +
        (opts.isDuyenHa ? "\nDuyên Hà: sau 14h được tính sang ngày hôm sau." : ""),
    };
  }
  return { ok: true };
}

/**
 * Validate ngày giao — V21 _validateDeliveryDate_
 * - bắt buộc
 * - CT phải có ngày nhận
 * - >= ngày nhận
 * - <= business today
 */
export function validateDeliveryDate(opts: {
  receivedDate?: string;
  deliveryDate: string;
  isDuyenHa?: boolean;
  detailId?: string;
}): { ok: true } | { ok: false; error: string } {
  const ngay = (opts.deliveryDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) {
    return { ok: false, error: "Vui lòng chọn ngày giao hàng (YYYY-MM-DD)." };
  }
  const recv = (opts.receivedDate || "").slice(0, 10);
  if (!recv || !/^\d{4}-\d{2}-\d{2}$/.test(recv)) {
    return {
      ok: false,
      error:
        (opts.detailId ? opts.detailId + " " : "") +
        "Chi tiết xe chưa có ngày nhận hàng, không thể lưu giao hàng.",
    };
  }
  if (ymdCompare(ngay, recv) < 0) {
    return {
      ok: false,
      error:
        `Ngày giao hàng không được nhỏ hơn ngày nhận hàng.\n` +
        `Ngày nhận: ${recv}\nNgày giao: ${ngay}` +
        (opts.isDuyenHa ? "\nDuyên Hà: sau 14h được tính sang ngày hôm sau." : ""),
    };
  }
  const maxDay = businessTodayKey(!!opts.isDuyenHa);
  if (ymdCompare(ngay, maxDay) > 0) {
    return {
      ok: false,
      error:
        `Ngày giao hàng không được lớn hơn ngày hôm nay.\n` +
        `Hôm nay hợp lệ: ${maxDay}` +
        (opts.isDuyenHa ? "\nDuyên Hà: sau 14h được tính sang ngày hôm sau." : ""),
    };
  }
  return { ok: true };
}

/**
 * Máy trạng thái CT sau nhận/giao — V21 syncDetailAndOrder_
 */
export function computeDetailStatus(opts: {
  currentStatus: string;
  thucNhan: number;
  totalThucGiao: number;
  tlHaohut: number;
}): string {
  const st = String(opts.currentStatus || "");
  if (st === "Hủy xe" || st === "CANCEL" || st === "Xóa xe" || st === "DELETE") {
    return st === "CANCEL" ? "Hủy xe" : st === "DELETE" ? "Xóa xe" : st;
  }
  const tn = Number(opts.thucNhan) || 0;
  const tg = Number(opts.totalThucGiao) || 0;
  if (!(tn > 0)) {
    // chưa nhận
    if (["Mới tạo", "NEW"].includes(st)) return "Mới tạo";
    if (["Đặt hàng", "ORDERED"].includes(st)) return "Đặt hàng";
    return st || "Đặt hàng";
  }
  if (tg <= 0) return "Đã nhận";
  if (tg < tn) {
    if (validateTolerance(tn, tg, opts.tlHaohut)) return "Hoàn thành";
    return "Đang giao";
  }
  return "Hoàn thành";
}

export function classifyPhanLoaiMain(raw: string): "Bao" | "Roi" | "Khac" {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi" || s.includes("roi") || s.includes("rời")) return "Roi";
  if (s.includes("bao")) return "Bao";
  return "Khac";
}
