/**
 * Chuẩn hóa ngày từ Google Sheets → YYYY-MM-DD
 * Hỗ trợ: serial Excel, DD/MM/YYYY, YYYY-MM-DD, Date string
 */
export function normalizeSheetDate(raw: string | number | undefined | null): string {
  if (raw === null || raw === undefined || raw === "") return "";

  // Excel / Sheets serial number
  if (typeof raw === "number" || (/^\d+(\.\d+)?$/.test(String(raw).trim()) && Number(raw) > 20000)) {
    const serial = Number(raw);
    // Sheets serial: days since 1899-12-30
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.floor(serial) * 86400000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const s = String(raw).trim();

  // Already ISO-like
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY or D/M/YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m1) {
    const dd = m1[1].padStart(2, "0");
    const mm = m1[2].padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // MM/DD/YYYY (US) — chỉ khi không parse được kiểu VN
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const yyyy = Number(m2[3]) > 50 ? `19${m2[3]}` : `20${m2[3]}`;
    return `${yyyy}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  }

  // Fallback Date parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return s;
}

export function yearOfDate(isoOrRaw: string): number | null {
  const iso = normalizeSheetDate(isoOrRaw);
  if (/^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
  return null;
}
