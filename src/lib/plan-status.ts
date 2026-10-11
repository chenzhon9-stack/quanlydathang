/**
 * KHSANLUONG — trạng thái & % hoàn thành.
 *
 * Quy ước (chốt 2026-10-11):
 * - TrangThai lưu trên Sheet là nguồn sự thật khi HIỂN THỊ / LỌC.
 * - Công thức computePlanStatus ghi Sheet tại create/update (và khi đổi ThucTe).
 * - UI KHÔNG suy lại Quá hạn/Hoàn thành lúc list (tránh lệch Sheet).
 *
 * Công thức (parity V21 getReportKeHoach, ghi ngược Sheet):
 *   if saved/forced Hủy → "Hủy"
 *   else if planned > 0 && actual/planned >= 1 → "Hoàn thành"
 *   else if DenNgay < hôm nay (VN) → "Quá hạn"
 *   else → "Đang thực hiện"
 */
import { todayYmdVN, ymdDate } from "@/lib/sheets/date";

export type PlanStatusLabel =
  | "Đang thực hiện"
  | "Hoàn thành"
  | "Quá hạn"
  | "Hủy";

function fold(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPlanCancelled(raw?: string | null): boolean {
  return fold(String(raw || "")).includes("huy");
}

/** % HT — làm tròn 1 chữ số thập phân (parity UI). */
export function planProgressPct(
  planned?: number | null,
  actual?: number | null
): number {
  const p = Number(planned) || 0;
  if (p <= 0) return 0;
  const a = Number(actual) || 0;
  return Math.round((a / p) * 1000) / 10;
}

/**
 * Tính TrangThai để GHI Sheet tại thời điểm cập nhật.
 * Không dùng để “suy” khi chỉ đọc list.
 */
export function computePlanStatus(input: {
  /** Status hiện có trên sheet / user — nếu Hủy thì giữ Hủy */
  status?: string | null;
  toDate?: string | null;
  plannedQuantity?: number | null;
  actualQuantity?: number | null;
  /** forceCancel = true khi API cancel */
  forceCancel?: boolean;
}): PlanStatusLabel {
  if (input.forceCancel || isPlanCancelled(input.status)) {
    return "Hủy";
  }

  const planned = Number(input.plannedQuantity) || 0;
  const actual = Number(input.actualQuantity) || 0;
  if (planned > 0 && actual / planned >= 1 - 1e-9) {
    return "Hoàn thành";
  }

  const to = ymdDate(input.toDate) || String(input.toDate || "").slice(0, 10);
  const today = todayYmdVN();
  if (to && to.length >= 10 && to < today) {
    return "Quá hạn";
  }

  return "Đang thực hiện";
}

/** Band màu dòng theo % (V21 renderKeHoachList) — không theo status. */
export function planPctBand(pct: number): "done" | "high" | "mid" | "low" {
  if (pct >= 100) return "done";
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
}

/**
 * @deprecated Giữ export để không vỡ import cũ — UI nên dùng status Sheet.
 * Hành vi: trả về status sheet đã chuẩn hoá; chỉ map alias, KHÔNG suy DenNgay.
 */
export function effectivePlanStatus(p: {
  status?: string | null;
  toDate?: string | null;
  plannedQuantity?: number | null;
  actualQuantity?: number | null;
}): string {
  const raw = String(p.status || "").trim();
  if (isPlanCancelled(raw)) return "Hủy";
  const f = fold(raw);
  if (f.includes("hoan thanh") || f.includes("done")) return "Hoàn thành";
  if (f.includes("qua han") || f.includes("overdue")) return "Quá hạn";
  if (f.includes("dang thuc hien") || f.includes("active") || !raw) {
    return "Đang thực hiện";
  }
  return raw || "Đang thực hiện";
}
