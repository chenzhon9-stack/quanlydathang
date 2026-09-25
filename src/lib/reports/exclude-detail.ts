/**
 * V21 report parity — loại chi tiết Hủy xe / Xóa xe khỏi tổng sản lượng.
 *
 * getReportThucNhan: skip STATUS_CT.DELETE; ThucNhan<=0 (CANCEL thường đã về 0).
 * getReportThucGiao: skip GH deleted + CT.DELETE.
 * Yêu cầu nghiệp vụ: loại trừ rõ cả Hủy xe và Xóa xe khi tính lượng.
 */
import type { DetailStatus } from "@/types";

const EXCLUDE = new Set([
  "CANCEL",
  "DELETE",
  "Hủy xe",
  "Hủy",
  "Xóa xe",
  "Xóa",
]);

export function isExcludedDetailStatus(
  status: string | DetailStatus | null | undefined
): boolean {
  const s = String(status || "").trim();
  if (!s) return false;
  if (EXCLUDE.has(s)) return true;
  const u = s.toUpperCase();
  if (u === "CANCEL" || u === "DELETE") return true;
  // normalized VN without diacritics edge
  const fold = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (fold.includes("huy xe") || fold === "huy") return true;
  if (fold.includes("xoa xe") || fold === "xoa") return true;
  return false;
}

/** Chi tiết còn hiệu lực cho báo cáo sản lượng */
export function isActiveDetailForReport(d: {
  status?: string;
  actualReceived?: number;
}): boolean {
  if (isExcludedDetailStatus(d.status)) return false;
  return true;
}
