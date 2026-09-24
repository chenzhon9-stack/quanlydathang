/**
 * Tìm kiếm tiếng Việt không dấu — parity UX V21
 * "hoang mai" khớp "Hoàng Mai", "XM" khớp "Xi măng"
 */

/** Bỏ dấu + chuẩn hóa đ/Đ, khoảng trắng */
export function removeDiacritics(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fold để so khớp: lower + không dấu */
export function foldVn(input: string): string {
  return removeDiacritics(String(input || "")).toLowerCase();
}

/**
 * Khớp query với haystack (không dấu).
 * Hỗ trợ nhiều từ cách nhau bởi khoảng trắng / ; / +
 * (AND giữa các phần).
 */
export function matchSearchVn(haystack: string, query: string): boolean {
  const q = foldVn(query);
  if (!q) return true;
  const hay = foldVn(haystack);
  const parts = q.split(/[\s;+]+/).filter(Boolean);
  if (!parts.length) return true;
  return parts.every((p) => hay.includes(p));
}

/** Build haystack từ nhiều field */
export function buildHaystack(
  ...parts: Array<string | number | null | undefined>
): string {
  return parts
    .map((p) => (p == null ? "" : String(p)))
    .filter(Boolean)
    .join(" ");
}
