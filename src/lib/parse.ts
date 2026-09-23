/** Parse số kiểu Sheets / VN: 1.234.567,89 | 1,234,567.89 | 1234567 */
export function parseNumberVN(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  // bỏ đơn vị / khoảng trắng
  s = s.replace(/\s/g, "").replace(/đ/gi, "");
  // 1.234.567,89 (VN)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // 1,234,567.89 (US)
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    // 1234,5
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
