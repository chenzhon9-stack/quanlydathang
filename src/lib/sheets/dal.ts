import { getSheetsClient, getSpreadsheetId } from "./client";

/** Read a sheet range and return rows as objects keyed by header (row 1). */
export async function readSheetAsObjects(
  sheetName: string,
  options?: { year?: number; range?: string }
): Promise<Record<string, string>[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(options?.year);
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
  if (values.length < 2) return [];

  const headers = (values[0] as string[]).map((h) =>
    String(h ?? "").trim()
  );

  return values.slice(1).map((row) => {
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


/** Ghi đè một dòng theo khóa (cột keyField = keyValue). Trả về row index 1-based hoặc -1. */
export async function updateSheetRowByKey(
  sheetName: string,
  keyField: string,
  keyValue: string,
  patch: Record<string, string | number | boolean>,
  year?: number
): Promise<number> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values = res.data.values || [];
  if (values.length < 2) return -1;
  const headers = (values[0] as string[]).map((h) => String(h ?? "").trim());
  const keyIdx = headers.findIndex(
    (h) => h.toLowerCase() === keyField.toLowerCase()
  );
  if (keyIdx < 0) throw new Error(`Thiếu cột ${keyField}`);

  const target = String(keyValue).trim().toLowerCase();
  let rowIndex = -1; // 0-based in values
  for (let i = 1; i < values.length; i++) {
    const cell = String(values[i][keyIdx] ?? "").trim().toLowerCase();
    if (cell === target) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) return -1;

  const row = values[rowIndex].slice();
  while (row.length < headers.length) row.push("");
  Object.entries(patch).forEach(([field, val]) => {
    const ci = headers.findIndex(
      (h) => h.toLowerCase() === field.toLowerCase()
    );
    if (ci < 0) return;
    if (typeof val === "boolean") row[ci] = val ? "TRUE" : "FALSE";
    else row[ci] = val as string | number;
  });

  const a1Row = rowIndex + 1; // 1-based
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${a1Row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
  return a1Row;
}

/** Append một dòng object theo header sheet */
export async function appendSheetRow(
  sheetName: string,
  data: Record<string, string | number | boolean>,
  year?: number
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId(year);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headers = ((res.data.values || [])[0] || []).map((h: unknown) =>
    String(h ?? "").trim()
  );
  if (!headers.length) throw new Error(`Sheet ${sheetName} thiếu header`);
  const row = headers.map((h) => {
    const v = data[h];
    if (v === undefined || v === null) return "";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return v;
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}
