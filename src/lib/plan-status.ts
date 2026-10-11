/**
 * Trạng thái hiệu lực kế hoạch sản lượng — parity V21 list KHSANLUONG.
 *
 * Sheet lưu TrangThai: "Đang thực hiện" | "Hoàn thành" | "Hủy" | (đôi khi "Quá hạn").
 * V21 khi render list:
 * - Hủy / Hoàn thành: giữ nguyên cột sheet
 * - Còn lại: nếu DenNgay < hôm nay (VN) → hiển thị "Quá hạn"
 * - Ngược lại → "Đang thực hiện" (hoặc giá trị sheet nếu đã là Quá hạn)
 *
 * Không tự đổi thành Hoàn thành khi %≥100 — % chỉ dùng tô màu; HT do user/sheet.
 */
import { todayYmdVN, ymdDate } from "@/lib/sheets/date";

export type PlanStatusKind = "ACTIVE" | "DONE" | "OVERDUE" | "CANCEL" | "OTHER";

function fold(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Phân loại status sheet thô */
export function classifyPlanStatusRaw(raw?: string | null): PlanStatusKind {
  const f = fold(String(raw || ""));
  if (!f) return "ACTIVE";
  if (f.includes("huy")) return "CANCEL";
  if (f.includes("hoan thanh") || f === "hoan" || f.includes("done")) return "DONE";
  if (f.includes("qua han") || f.includes("overdue")) return "OVERDUE";
  if (f.includes("dang thuc hien") || f.includes("active")) return "ACTIVE";
  return "OTHER";
}

/**
 * Status hiển thị trên UI / filter — parity V21.
 */
export function effectivePlanStatus(p: {
  status?: string | null;
  toDate?: string | null;
}): string {
  const raw = String(p.status || "").trim();
  const kind = classifyPlanStatusRaw(raw);

  if (kind === "CANCEL") return "Hủy";
  if (kind === "DONE") return "Hoàn thành";

  const to = ymdDate(p.toDate) || String(p.toDate || "").slice(0, 10);
  const today = todayYmdVN();
  if (to && to.length >= 10 && to < today) {
    return "Quá hạn";
  }

  if (kind === "OVERDUE") return "Quá hạn";
  if (raw && kind === "OTHER") return raw;
  return "Đang thực hiện";
}

export function planStatusKindFromEffective(effective: string): PlanStatusKind {
  return classifyPlanStatusRaw(effective);
}
