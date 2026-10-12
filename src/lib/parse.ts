/** Parse số kiểu Sheets / VN: 1.234.567,89 | 1,234,567.89 | 66,6 | 66.6 */
export function parseNumberVN(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;

  // NBSP / khoảng trắng hẹp / đơn vị
  s = s
    .replace(/[\s\u00A0\u202F\u2009]/g, "")
    .replace(/đ/gi, "")
    .replace(/%/g, "");

  // Chỉ dấu âm ở đầu
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // 1.234.567,89 (VN: chấm nghìn, phẩy thập phân)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // 1,234,567.89 (US: phẩy nghìn, chấm thập phân)
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  }
  // 1234,56 hoặc 66,6 (phẩy thập phân, không có chấm)
  else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(",", ".");
  }
  // 1234.56 — giữ nguyên; nếu nhiều chấm không khớp pattern VN ở trên → bỏ hết chấm nghìn lệch
  else if (s.includes(",") && s.includes(".")) {
    // 1.234,56 đã bắt ở trên; còn lại: lấy dấu cuối làm thập phân
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else {
    // bỏ phẩy nghìn còn sót
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? sign * n : 0;
}
