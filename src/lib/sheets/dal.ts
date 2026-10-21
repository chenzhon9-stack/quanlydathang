import { isSheetDateEndField, isSheetDateOnlyField, toSheetSerialDate, toSheetSerialDateTime, toSheetSerialEndOfDay, ymdDate } from "./date";
import { getSheetsClient, getSpreadsheetId } from "./client";
import {
  getSheetCache,
  setSheetCache,
  invalidateSheetCache,
} from "./sheet-cache";

export { invalidateSheetCache } from "./sheet-cache";

/** Read a sheet range and return rows as objects keyed by header (row 1). */
export async function readSheetAsObjects(
  sheetName: string,
  options?: { year?: number; range?: string; /** bỏ qua cache */ noCache?: boolean }
): Promise<Record<string, string>[]> {
  const year = options?.year;
  const useCache = !options?.range && !options?.noCache;

  if (useCache) {
    const hit = getSheetCache(sheetName, year);
    if (hit) {
      if (process.env.SHEET_CACHE_DEBUG === "1") {
        console.info(`[sheet-cache] HIT ${year ?? "-"}|${sheetName} n=${hit.length}`);
      }
      return hit;
    }
  }

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const range = options?.range
    ? `${sheetName}!${options.range}`
    : sheetName;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const values = res.data.values || [];
  if (values.length < 2) {
    if (useCache) setSheetCache(sheetName, [], year);
    return [];
  }

  const headers = (values[0] as string[]).map((h) =>
    String(h ?? "").trim()
  );

  const rows = values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const cell = row[i];
      if (cell === null || cell === undefined) obj[h] = "";
      else if (typeof cell === "number") obj[h] = String(cell);
      else obj[h] = String(cell).trim();
    });
    return obj;
  });

  if (useCache) {
    setSheetCache(sheetName, rows, year);
    if (process.env.SHEET_CACHE_DEBUG === "1") {
      console.info(`[sheet-cache] MISS ${year ?? "-"}|${sheetName} n=${rows.length}`);
    }
  }
  return rows;
}

/** Batch read multiple sheets in one API call. */
export async function batchReadSheets(
  sheetNames: string[],
  year?: number
): Promise<Record<string, Record<string, string>[]>> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: sheetNames,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const result: Record<string, Record<string, string>[]> = {};

  (res.data.valueRanges || []).forEach((vr, idx) => {
    const name = sheetNames[idx];
    const values = vr.values || [];
    if (values.length < 2) {
      result[name] = [];
      return;
    }
    const headers = (values[0] as string[]).map((h) =>
      String(h ?? "").trim()
    );
    result[name] = values.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        const cell = row[i];
        obj[h] =
          cell === null || cell === undefined ? "" : String(cell).trim();
      });
      return obj;
    });
  });

  return result;
}



function coerceWriteValue(
  field: string,
  val: string | number | boolean
): string | number | boolean {
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return val;
  const s = String(val ?? "").trim();
  if (!s) return "";
  // NgayDatHang: giữ full datetime (serial có giờ)
  if (/^NgayDatHang$/i.test(field) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const serial = toSheetSerialDateTime(s);
    return serial === "" ? s : serial;
  }
  // "Đến ngày" (DenNgay) → 23:59:59 — parity V21 _dateEndOfDay_
  if (isSheetDateEndField(field) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const serial = toSheetSerialEndOfDay(s.slice(0, 10));
    return serial === "" ? s : serial;
  }
  // Date-only business fields → Sheets serial (Date 00:00:00)
  if (isSheetDateOnlyField(field) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    // pure date or date+time string
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const serial = toSheetSerialDate(s);
      return serial === "" ? s : serial;
    }
    const serial = toSheetSerialDateTime(s);
    return serial === "" ? s : serial;
  }
  // TimeChange / DeletedAt as datetime serial if looks like date
  if (
    /^(TimeChange|DeletedAt|UpdatedAt|CreatedAt|ApprovedAt|LastLogin|NgayTao|NgayCapNhat)$/i.test(
      field
    ) &&
    (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s))
  ) {
    const serial = toSheetSerialDateTime(s);
    return serial === "" ? s : serial;
  }
  return val;
}

// ─────────────────────────────────────────────────────────────
// Header cache + ghi theo lô (giảm số lời gọi Sheets API)
// ─────────────────────────────────────────────────────────────

type HeaderEntry = { at: number; headers: string[] };
const headerStore = new Map<string, HeaderEntry>();
/** TTL ngắn: thêm/đổi cột trên Sheet được nhận sau tối đa ~60s */
const HEADER_TTL_MS = 60_000;
/** Đoán vị trí cột khoá theo (spreadsheet|sheet|keyField) để đọc kèm header 1 lần */
const keyColGuess = new Map<string, number>();

function normHeaders(row: unknown[] | undefined): string[] {
  return (row || []).map((h) => String(h ?? "").trim());
}

function headerKey(sheetName: string, year?: number): string {
  return `${getSpreadsheetId(year)}|${sheetName}`;
}

export function invalidateHeaderCache(sheetName?: string, year?: number): void {
  if (!sheetName) {
    headerStore.clear();
    keyColGuess.clear();
    return;
  }
  headerStore.delete(headerKey(sheetName, year));
}

/** Cột 0-based → chữ cái A1 (0→A, 25→Z, 26→AA) */
export function colLetter(idx: number): string {
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function setHeaders(sheetName: string, year: number | undefined, headers: string[]) {
  headerStore.set(headerKey(sheetName, year), { at: Date.now(), headers });
}

/** Header (dòng 1) của sheet — cache 60s. */
export async function getSheetHeaders(
  sheetName: string,
  year?: number,
  opts?: { fresh?: boolean }
): Promise<string[]> {
  const hk = headerKey(sheetName, year);
  if (!opts?.fresh) {
    const hit = headerStore.get(hk);
    if (hit && Date.now() - hit.at < HEADER_TTL_MS) return hit.headers;
  }
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(year),
    range: `${sheetName}!1:1`,
  });
  const headers = normHeaders((res.data.values || [])[0]);
  if (headers.length) setHeaders(sheetName, year, headers);
  return headers;
}

/** Nạp header của nhiều sheet bằng 1 lời gọi (chỉ sheet chưa có / hết hạn). */
export async function prefetchSheetHeaders(
  sheetNames: string[],
  year?: number
): Promise<void> {
  const need = sheetNames.filter((n) => {
    const hit = headerStore.get(headerKey(n, year));
    return !hit || Date.now() - hit.at >= HEADER_TTL_MS;
  });
  if (!need.length) return;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: getSpreadsheetId(year),
    ranges: need.map((n) => `${n}!1:1`),
  });
  (res.data.valueRanges || []).forEach((vr, i) => {
    const headers = normHeaders((vr.values || [])[0]);
    if (headers.length) setHeaders(need[i], year, headers);
  });
}

type CellData = { range: string; values: (string | number | boolean)[][] };

/**
 * Cập nhật NHIỀU dòng theo khoá trong 1 lần ghi.
 * - 1 lời gọi đọc (header + CHỈ cột khoá, không đọc cả sheet)
 * - 1 lời gọi `values.batchUpdate` — chỉ ghi các ô trong patch (không ghi đè cả dòng,
 *   nên không làm mất thay đổi ở cột khác do GAS/người dùng ghi cùng lúc)
 * Trả về Map(key → số dòng A1 1-based, hoặc -1 nếu không tìm thấy).
 */
export async function updateSheetRowsByKey(
  sheetName: string,
  keyField: string,
  items: Array<{ key: string; patch: Record<string, string | number | boolean> }>,
  year?: number
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!items.length) return result;

  // gộp patch trùng khoá (patch sau ghi đè patch trước)
  const merged = new Map<
    string,
    { key: string; patch: Record<string, string | number | boolean> }
  >();
  for (const it of items) {
    const lk = String(it.key ?? "").trim().toLowerCase();
    const prev = merged.get(lk);
    merged.set(lk, {
      key: String(it.key ?? "").trim(),
      patch: { ...(prev?.patch || {}), ...it.patch },
    });
  }

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const gk = `${spreadsheetId}|${sheetName}|${keyField.toLowerCase()}`;
  const guess = keyColGuess.get(gk) ?? 0;

  const first = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      `${sheetName}!1:1`,
      `${sheetName}!${colLetter(guess)}:${colLetter(guess)}`,
    ],
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const vr = first.data.valueRanges || [];
  const headers = normHeaders((vr[0]?.values || [])[0]);
  const keyIdx = headers.findIndex(
    (h) => h.toLowerCase() === keyField.toLowerCase()
  );
  if (keyIdx < 0) throw new Error(`Thiếu cột ${keyField}`);
  setHeaders(sheetName, year, headers);

  let keyVals: unknown[][] = (vr[1]?.values || []) as unknown[][];
  if (keyIdx !== guess) {
    const col = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${colLetter(keyIdx)}:${colLetter(keyIdx)}`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    keyVals = (col.data.values || []) as unknown[][];
  }
  keyColGuess.set(gk, keyIdx);

  const rowByKey = new Map<string, number>();
  for (let i = 1; i < keyVals.length; i++) {
    const cell = String((keyVals[i] || [])[0] ?? "").trim().toLowerCase();
    if (cell && !rowByKey.has(cell)) rowByKey.set(cell, i + 1);
  }

  // kết quả theo ĐÚNG khoá người gọi truyền vào (kể cả khi trùng khác hoa/thường)
  for (const it of items) {
    result.set(
      String(it.key ?? "").trim(),
      rowByKey.get(String(it.key ?? "").trim().toLowerCase()) ?? -1
    );
  }

  const data: CellData[] = [];
  for (const [lk, it] of merged) {
    const row = rowByKey.get(lk);
    if (!row) continue;
    for (const [field, val] of Object.entries(it.patch)) {
      const ci = headers.findIndex(
        (h) => h.toLowerCase() === field.toLowerCase()
      );
      if (ci < 0) continue;
      data.push({
        range: `${sheetName}!${colLetter(ci)}${row}`,
        values: [[coerceWriteValue(field, val)]],
      });
    }
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
    invalidateSheetCache(sheetName, year);
  }
  return result;
}

/** Ghi đè một dòng theo khóa (cột keyField = keyValue). Trả về row index 1-based hoặc -1. */
export async function updateSheetRowByKey(
  sheetName: string,
  keyField: string,
  keyValue: string,
  patch: Record<string, string | number | boolean>,
  year?: number
): Promise<number> {
  const m = await updateSheetRowsByKey(
    sheetName,
    keyField,
    [{ key: keyValue, patch }],
    year
  );
  return m.get(String(keyValue ?? "").trim()) ?? -1;
}

/**
 * Cập nhật nhiều dòng theo SỐ DÒNG A1 đã biết (1-based, header = 1) — 1 lời gọi ghi
 * (header lấy từ cache). Dùng khi đã đọc sheet và biết vị trí dòng (vd. System_Counter).
 */
export async function updateSheetRowsAt(
  sheetName: string,
  items: Array<{ a1Row: number; patch: Record<string, string | number | boolean> }>,
  year?: number
): Promise<void> {
  if (!items.length) return;
  const headers = await getSheetHeaders(sheetName, year);
  const data: CellData[] = [];
  for (const it of items) {
    if (it.a1Row < 2) throw new Error("Không ghi đè header");
    for (const [field, val] of Object.entries(it.patch)) {
      const ci = headers.findIndex(
        (h) => h.toLowerCase() === field.toLowerCase()
      );
      if (ci < 0) continue;
      data.push({
        range: `${sheetName}!${colLetter(ci)}${it.a1Row}`,
        values: [[coerceWriteValue(field, val)]],
      });
    }
  }
  if (!data.length) return;
  await getSheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(year),
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
  invalidateSheetCache(sheetName, year);
}


/** Cập nhật dòng theo số dòng A1 (1-based, gồm header = 1). */
export async function updateSheetRowAt(
  sheetName: string,
  a1Row: number,
  patch: Record<string, string | number | boolean>,
  year?: number
): Promise<void> {
  if (a1Row < 2) throw new Error("Không ghi đè header");
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${a1Row}:${a1Row}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headers = ((headerRes.data.values || [])[0] || []).map((h: unknown) =>
    String(h ?? "").trim()
  );
  const row = ((res.data.values || [])[0] || []).slice() as unknown[];
  while (row.length < headers.length) row.push("");
  Object.entries(patch).forEach(([field, val]) => {
    const ci = headers.findIndex(
      (h) => h.toLowerCase() === field.toLowerCase()
    );
    if (ci < 0) return;
    row[ci] = coerceWriteValue(field, val as string | number | boolean);
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${a1Row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
  invalidateSheetCache(sheetName, year);
}

/** Thêm NHIỀU dòng (object theo header) trong 1 lời gọi append. */
export async function appendSheetRows(
  sheetName: string,
  rows: Array<Record<string, string | number | boolean>>,
  year?: number
): Promise<void> {
  if (!rows.length) return;
  const headers = await getSheetHeaders(sheetName, year);
  if (!headers.length) throw new Error(`Sheet ${sheetName} thiếu header`);
  const values = rows.map((data) =>
    headers.map((h) => {
      const v = data[h];
      if (v === undefined || v === null) return "";
      return coerceWriteValue(h, v as string | number | boolean);
    })
  );
  await getSheetsClient().spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(year),
    range: sheetName,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  invalidateSheetCache(sheetName, year);
}

/** Append một dòng object theo header sheet */
export async function appendSheetRow(
  sheetName: string,
  data: Record<string, string | number | boolean>,
  year?: number
): Promise<void> {
  await appendSheetRows(sheetName, [data], year);
}

const sheetIdStore = new Map<string, number>();

async function getSheetId(sheetName: string, year?: number): Promise<number> {
  const hk = headerKey(sheetName, year);
  const hit = sheetIdStore.get(hk);
  if (hit !== undefined) return hit;
  const res = await getSheetsClient().spreadsheets.get({
    spreadsheetId: getSpreadsheetId(year),
    fields: "sheets.properties(sheetId,title)",
  });
  for (const sh of res.data.sheets || []) {
    const t = sh.properties?.title;
    if (t && sh.properties?.sheetId !== undefined && sh.properties?.sheetId !== null) {
      sheetIdStore.set(`${getSpreadsheetId(year)}|${t}`, sh.properties.sheetId);
    }
  }
  const id = sheetIdStore.get(hk);
  if (id === undefined) throw new Error(`Không tìm thấy sheet ${sheetName}`);
  return id;
}

/** Xóa các dòng (số dòng A1, 1-based, ≥ 2) trong 1 lời gọi. Chỉ dùng cho dọn dẹp dòng kỹ thuật. */
export async function deleteSheetRows(
  sheetName: string,
  a1Rows: number[],
  year?: number
): Promise<void> {
  const rows = [...new Set(a1Rows)].filter((r) => r >= 2).sort((a, b) => b - a);
  if (!rows.length) return;
  const sheetId = await getSheetId(sheetName, year);
  await getSheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(year),
    requestBody: {
      requests: rows.map((r) => ({
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r },
        },
      })),
    },
  });
  invalidateSheetCache(sheetName, year);
}
