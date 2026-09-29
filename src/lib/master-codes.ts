/** Helpers mã danh mục — parity V21 _suggestCodeFromName_ / _normalizePlate_ */

/** Parity V21 `_stripAccents_` — NFD + đ/Đ → d/D (chưa lower) */
export function stripAccents(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function normalizePlate(plate: string): string {
  return String(plate || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeNameForDup(v: string): string {
  return stripAccents(String(v || ""))
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVehicleText(v: string): string {
  return stripAccents(String(v || ""))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_STOP = [
  "CONG TY",
  "CTY",
  "TNHH",
  "MTV",
  "MOT THANH VIEN",
  "CP",
  "CO PHAN",
  "VAN TAI",
  "VT",
  "LOGISTICS",
  "LOGISTIC",
  "DICH VU",
  "DV",
  "THUONG MAI",
  "TM",
  "SX",
  "XD",
  "VA",
  "NHA XE",
  "DOANH NGHIEP",
  "DN",
];

export function suggestCodeFromName(
  ten: string,
  prefix = "ITEM",
  stopWords: string[] = DEFAULT_STOP
): string {
  let s = stripAccents(ten).toUpperCase();
  for (const w of stopWords) {
    s = s.replace(new RegExp("\\b" + w + "\\b", "g"), " ");
  }
  s = s.replace(/[^A-Z0-9]/g, "");
  if (!s) s = prefix;
  return s.slice(0, 16);
}

export function uniqueCodeFromUsed(
  base: string,
  used: Set<string>
): string {
  const b = (base || "ITEM").toUpperCase();
  if (!used.has(b)) return b;
  for (let i = 2; i < 1000; i++) {
    const code = b + String(i).padStart(2, "0");
    if (!used.has(code)) return code;
  }
  return b + Date.now().toString().slice(-6);
}

/**
 * Prefix MaXe theo MaHTVT — parity V21:
 *   NPP:"1P", NCC:"2C", THUE_NGOAI:"3T", KHACH:"4K"
 */
export const VEHICLE_HTVT_PREFIX: Record<string, string> = {
  NPP: "1P",
  NCC: "2C",
  THUE_NGOAI: "3T",
  KHACH: "4K",
  // alias form / sheet
  KHACH_HANG: "4K",
  KH_VAN_CHUYEN: "4K",
  KH: "4K",
};

export function vehicleCodePrefix(maHtvt: string): string {
  const k = String(maHtvt || "").toUpperCase().trim();
  if (VEHICLE_HTVT_PREFIX[k]) return VEHICLE_HTVT_PREFIX[k];
  if (k.includes("THUE")) return "3T";
  if (k.includes("KHACH") || k === "KH") return "4K";
  if (k.includes("NPP")) return "1P";
  if (k.includes("NCC")) return "2C";
  const cleaned = k.replace(/[^A-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "XX").padEnd(2, "X").slice(0, 2);
}

export function formatPhoneVn(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return d;
}
