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
