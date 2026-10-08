/**
 * Tìm kiếm tiếng Việt không dấu — parity V21 (matchesKeyword / parseKeyword)
 *
 * Toán tử:
 *   - ";"  → OR  (chỉ cần một nhóm khớp)
 *   - "+"  → AND (mọi phần trong nhóm đều phải có)
 *   - "<>" → NOT (phần trước phải có, phần sau không được có)
 *   - Không toán tử → tìm chuỗi con (substring)
 *
 * Ví dụ:
 *   "bim son"              → có cụm "bim son" (sau normalize)
 *   "bim + son"            → có "bim" VÀ có "son"
 *   "bim son; song lam"    → (bim son) HOẶC (song lam)
 *   "xi mang <> roi"       → có "xi mang" và KHÔNG có "roi"
 */

/** Bỏ dấu tiếng Việt (NFD + đ/Đ), giữ nguyên hoa/thường */
export function removeVietnameseAccents(str: string): string {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/**
 * Chuẩn hoá text tìm kiếm (V21 _normalizeSearchText_):
 *  - Bỏ dấu
 *  - Lowercase
 *  - Gộp space
 *  - Trim
 */
export function normalizeSearchText(s: string | null | undefined): string {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Alias cũ — dùng trong MasterPicker / code cũ */
export function removeDiacritics(input: string): string {
  return removeVietnameseAccents(input).replace(/\s+/g, " ").trim();
}

export function foldVn(input: string): string {
  return normalizeSearchText(input);
}

/**
 * Parser nội bộ — parity V21 parseKeyword
 * haystack / keyword đã normalize.
 */
function parseKeyword(haystack: string, keyword: string): boolean {
  if (!keyword) return true;
  if (!haystack && keyword) return false;

  // OR (ưu tiên thấp — tách ngoài cùng)
  const orParts = keyword
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (orParts.length > 1) {
    return orParts.some((part) => parseKeyword(haystack, part));
  }

  // AND
  const andParts = keyword
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  if (andParts.length > 1) {
    return andParts.every((part) => parseKeyword(haystack, part));
  }

  // NOT (<>)
  if (keyword.includes("<>")) {
    const notParts = keyword
      .split("<>")
      .map((s) => s.trim())
      .filter(Boolean);
    const hasPart = notParts[0] || "";
    const notPart = notParts.slice(1).join(" ");
    if (hasPart && notPart) {
      return haystack.includes(hasPart) && !haystack.includes(notPart);
    }
    if (hasPart) return haystack.includes(hasPart);
    if (notPart) return !haystack.includes(notPart);
    return true;
  }

  // Chuỗi con thông thường
  return haystack.indexOf(keyword) >= 0;
}

/**
 * Khớp keyword với haystack — parity V21 matchesKeyword
 */
export function matchesKeyword(
  haystack: string | null | undefined,
  keyword: string | null | undefined
): boolean {
  if (!keyword || !String(keyword).trim()) return true;
  try {
    const normalizedHaystack = normalizeSearchText(haystack);
    const normalizedKw = normalizeSearchText(keyword);
    if (!normalizedKw) return true;
    return parseKeyword(normalizedHaystack, normalizedKw);
  } catch {
    const safeHay = String(haystack || "").toLowerCase();
    const safeKw = String(keyword || "").toLowerCase();
    return safeHay.includes(safeKw);
  }
}

/**
 * API cũ dùng ở ListToolbar / tabs / reports / picker.
 * Giữ signature; bên trong = matchesKeyword (V21).
 *
 * "bim son" tìm cụm substring. Muốn AND từng từ: "bim + son".
 */
export function matchSearchVn(haystack: string, query: string): boolean {
  return matchesKeyword(haystack, query);
}

/** Ghép cột thành haystack — parity V21 buildRowHaystack */
export function buildRowHaystack(
  row: Record<string, unknown> | null | undefined,
  cols: Array<{ key: string }>
): string {
  return (cols || [])
    .map((c) => {
      const v = row ? row[c.key] : "";
      return String(v == null ? "" : v).toLowerCase();
    })
    .join(" ");
}

export function buildHaystack(
  ...parts: Array<string | number | null | undefined>
): string {
  return parts
    .map((p) => (p == null ? "" : String(p)))
    .filter(Boolean)
    .join(" ");
}
