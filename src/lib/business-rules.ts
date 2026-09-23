/**
 * Business rules ported from V21 (qty3, chia hết, ngày nhận).
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
 */
export function validateStep(value: number, step: number): boolean {
  const s = Number(step) || 0;
  if (s <= EPS) return true;
  const v = qty3(value);
  const k = Math.round(v / s);
  return Math.abs(v - k * s) < 1e-6;
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

/**
 * Validate ngày nhận (rút gọn V21 _validateReceiveDate_).
 * - >= ngày đặt
 * - <= business today (Duyên Hà sau 14h: today = tomorrow? V21: sau 14h cộng 1 ngày vào "business today" khi so sánh)
 * Đơn giản hóa: maxDate = hôm nay; nếu isDuyenHa && hour>=14 thì maxDate vẫn hôm nay nhưng min vẫn orderDate.
 * Rule V21: không vượt business today; Duyên Hà cutoff 14:00 ảnh hưởng ngày nghiệp vụ đặt/gửi — với nhận: không future.
 */
export function validateReceiveDate(opts: {
  orderDate?: string;
  receivedDate: string;
  isDuyenHa?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const ngay = (opts.receivedDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) {
    return { ok: false, error: "Ngày nhận không hợp lệ (YYYY-MM-DD)" };
  }
  const order = (opts.orderDate || "").slice(0, 10);
  if (order && ymdCompare(ngay, order) < 0) {
    return { ok: false, error: `Ngày nhận không được trước ngày đặt (${order})` };
  }
  let maxDay = todayYmdVN();
  // Duyên Hà: sau 14h vẫn cho nhận trong ngày hôm nay; không cho tương lai
  if (ymdCompare(ngay, maxDay) > 0) {
    return { ok: false, error: `Ngày nhận không được sau hôm nay (${maxDay})` };
  }
  return { ok: true };
}

export function classifyPhanLoaiMain(raw: string): "Bao" | "Roi" | "Khac" {
  const s = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (s === "bao") return "Bao";
  if (s === "roi" || s === "rời" || s === "roi ") return "Roi";
  if (s.includes("roi") || s.includes("rời")) return "Roi";
  if (s.includes("bao")) return "Bao";
  return "Khac";
}
