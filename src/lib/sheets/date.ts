/**
 * Chuẩn hóa ngày từ Google Sheets → YYYY-MM-DD
 * Serial Sheets: đếm ngày từ 1899-12-30 (civil), format UTC components.
 * Chuỗi: ưu tiên DD/MM/YYYY (VN); nếu ngày > 12 thì chắc chắn DD/MM.
 */
export function normalizeSheetDate(raw: string | number | undefined | null): string {
  if (raw === null || raw === undefined || raw === "") return "";

  if (typeof raw === "number" || (/^\d+(\.\d+)?$/.test(String(raw).trim()) && Number(raw) > 20000)) {
    const serial = Math.floor(Number(raw));
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + serial * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY or MM/DD/YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m1) {
    const a = Number(m1[1]);
    const b = Number(m1[2]);
    const yyyy = m1[3];
    // Nếu a > 12 → a là ngày (DD/MM)
    // Nếu b > 12 → b là ngày (MM/DD)
    // Mặc định VN: DD/MM
    let dd: number;
    let mm: number;
    if (a > 12 && b <= 12) {
      dd = a;
      mm = b;
    } else if (b > 12 && a <= 12) {
      mm = a;
      dd = b;
    } else {
      // cả hai <= 12: ưu tiên DD/MM (VN)
      dd = a;
      mm = b;
    }
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const yyyy = Number(m2[3]) > 50 ? `19${m2[3]}` : `20${m2[3]}`;
    const dd = Number(m2[1]);
    const mm = Number(m2[2]);
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    // local YMD to avoid UTC shift for parsed strings
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  return s;
}

export function yearOfDate(isoOrRaw: string): number | null {
  const iso = normalizeSheetDate(isoOrRaw);
  if (/^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
  return null;
}
