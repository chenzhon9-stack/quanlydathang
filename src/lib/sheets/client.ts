import { google, sheets_v4 } from "googleapis";
import { currentYearVN } from "./date";

let sheetsClient: sheets_v4.Sheets | null = null;

export function isSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      (process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
        listConfiguredYears().length > 0)
  );
}

const YEAR_ENV_PREFIX = "GOOGLE_SHEETS_SPREADSHEET_ID_";

function cleanEnv(v: string | undefined): string {
  return String(v ?? "").trim();
}

/** Năm mặc định khi không truyền `year` = năm hiện tại (giờ VN). */
export function defaultSheetYear(): number {
  return currentYearVN();
}

/** Chuẩn hóa year (undefined → năm hiện tại) — dùng làm khóa cache để `undefined` và năm hiện tại là một. */
export function resolveSheetYear(year?: number): number {
  const y = Number(year);
  return Number.isFinite(y) && y >= 2000 && y <= 2100 ? Math.floor(y) : defaultSheetYear();
}

let warnedLegacy = false;

/**
 * Chọn Spreadsheet theo kỳ (năm). Thứ tự:
 *  1. `GOOGLE_SHEETS_SPREADSHEET_ID_{YYYY}` — file riêng của năm đó (khuyến nghị khai báo cho MỌI năm, kể cả năm hiện tại).
 *  2. `GOOGLE_SHEETS_SPREADSHEET_ID` (file chung, kiểu cũ) — chỉ phục vụ đúng 1 năm:
 *       `GOOGLE_SHEETS_MAIN_YEAR` nếu có đặt; nếu không đặt thì là năm hiện tại.
 *     `GOOGLE_SHEETS_STRICT_YEARS=1` tắt hẳn nhánh này (bắt buộc khai báo biến theo năm).
 *  3. Còn lại → báo lỗi rõ ràng (trước đây âm thầm đọc nhầm file chung).
 */
export function getSpreadsheetId(year?: number): string {
  const y = resolveSheetYear(year);
  const perYear = cleanEnv(process.env[`${YEAR_ENV_PREFIX}${y}`]);
  if (perYear) return perYear;

  const main = cleanEnv(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
  const strict = ["1", "true"].includes(
    cleanEnv(process.env.GOOGLE_SHEETS_STRICT_YEARS).toLowerCase()
  );
  const mainYearRaw = Number(cleanEnv(process.env.GOOGLE_SHEETS_MAIN_YEAR));
  const mainYear =
    Number.isFinite(mainYearRaw) && mainYearRaw >= 2000
      ? Math.floor(mainYearRaw)
      : defaultSheetYear();

  if (main && !strict && y === mainYear) {
    if (!warnedLegacy) {
      warnedLegacy = true;
      console.warn(
        `[sheets] Năm ${y} dùng GOOGLE_SHEETS_SPREADSHEET_ID chung — nên khai báo ${YEAR_ENV_PREFIX}${y} để đổi kỳ không đọc nhầm file.`
      );
    }
    return main;
  }

  const err = new Error(
    `Chưa cấu hình Spreadsheet cho năm ${y}: đặt biến ${YEAR_ENV_PREFIX}${y}.`
  ) as Error & { code?: string };
  err.code = "YEAR_NOT_CONFIGURED";
  throw err;
}

/** Các năm đã khai báo biến riêng (tăng dần) — dùng cho trang quản trị / gỡ lỗi. */
export function listConfiguredYears(): number[] {
  const out: number[] = [];
  for (const k of Object.keys(process.env)) {
    const m = k.match(/^GOOGLE_SHEETS_SPREADSHEET_ID_(\d{4})$/);
    if (m && cleanEnv(process.env[k])) out.push(Number(m[1]));
  }
  return out.sort((x, y) => x - y);
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY"
    );
  }

  // Vercel / env often stores \n as literal backslash-n
  key = key.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}
