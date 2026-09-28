/**
 * Tìm kiếm tiếng Việt không dấu — parity UX V21
 *
 * Toán tử:
 *   - "Hoặc (;)"  : các nhóm OR
 *   - "Và (+)"    : trong mỗi nhóm AND (khoảng trắng cũng là AND)
 *
 * Ví dụ:
 *   "bim son"           → bim AND son
 *   "bim + son"         → bim AND son
 *   "bim son; song lam" → (bim AND son) OR (song AND lam)
 */

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

export function foldVn(input: string): string {
  return removeDiacritics(String(input || "")).toLowerCase();
}

export function matchSearchVn(haystack: string, query: string): boolean {
  const q = foldVn(query);
  if (!q) return true;
  const hay = foldVn(haystack);

  const orGroups = q
    .split(";")
    .map((g) => g.trim())
    .filter(Boolean);
  if (!orGroups.length) return true;

  return orGroups.some((group) => {
    const andParts = group
      .split(/[+\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!andParts.length) return true;
    return andParts.every((p) => hay.includes(p));
  });
}

export function buildHaystack(
  ...parts: Array<string | number | null | undefined>
): string {
  return parts
    .map((p) => (p == null ? "" : String(p)))
    .filter(Boolean)
    .join(" ");
}
