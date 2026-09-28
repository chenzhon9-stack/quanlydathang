import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  isSheetsConfigured,
  getSpreadsheetId,
  getSheetsClient,
} from "@/lib/sheets/client";
import { SHEETS } from "@/lib/sheets/constants";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { success, error, jsonResponse } from "@/lib/api";

const PROBE = [
  SHEETS.DH,
  SHEETS.CT,
  SHEETS.GH,
  SHEETS.KHSL,
  SHEETS.CN,
  SHEETS.DD,
  SHEETS.GM,
  SHEETS.NCC,
  SHEETS.KH,
  SHEETS.HH,
  SHEETS.XE,
  SHEETS.KV,
  SHEETS.HTVT,
  SHEETS.DVT,
  SHEETS.NCC_HH,
  SHEETS.USER,
] as const;

/**
 * GET /api/v1/debug/sheets — chẩn đoán kết nối + đếm dòng sheet nghiệp vụ
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const year = Number(req.nextUrl.searchParams.get("year") || 2026);
    const configured = isSheetsConfigured();
    const out: Record<string, unknown> = {
      configured,
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
        ? String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID).slice(0, 12) + "…"
        : null,
      spreadsheetId2025: process.env.GOOGLE_SHEETS_SPREADSHEET_ID_2025
        ? String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID_2025).slice(0, 12) +
          "…"
        : null,
      hasPrivateKey: Boolean(process.env.GOOGLE_PRIVATE_KEY),
      privateKeyLooksValid: Boolean(
        process.env.GOOGLE_PRIVATE_KEY?.includes("BEGIN")
      ),
      year,
    };

    if (!configured) {
      return jsonResponse(
        success({
          ...out,
          message: "Thiếu env Service Account — app không đọc được Sheet thật",
        })
      );
    }

    try {
      const sheets = getSheetsClient();
      const spreadsheetId = getSpreadsheetId(year);

      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties.title",
      });
      const tabNames =
        meta.data.sheets?.map((s) => s.properties?.title || "") || [];
      out.workbookTitle = meta.data.properties?.title || null;
      out.tabCount = tabNames.length;
      out.tabs = tabNames;

      const probes: Record<
        string,
        { exists: boolean; rows?: number; headers?: string[]; error?: string }
      > = {};

      for (const name of PROBE) {
        const exists = tabNames.includes(name);
        if (!exists) {
          // fuzzy: case-insensitive / trim
          const found = tabNames.find(
            (t) => t.trim().toLowerCase() === name.toLowerCase()
          );
          if (!found) {
            probes[name] = { exists: false, error: "TAB_NOT_FOUND" };
            continue;
          }
        }
        try {
          const rows = await readSheetAsObjects(name, { year });
          const headers = rows[0] ? Object.keys(rows[0]) : [];
          probes[name] = {
            exists: true,
            rows: rows.length,
            headers: headers.slice(0, 12),
          };
        } catch (e: unknown) {
          probes[name] = {
            exists: true,
            error: String((e as Error)?.message || e).slice(0, 200),
          };
        }
      }
      out.probes = probes;

      // Gợi ý nhanh
      const tips: string[] = [];
      if (!probes[SHEETS.KHSL]?.rows)
        tips.push("KHSANLUONG trống hoặc không có tab → tab Kế hoạch rỗng");
      if (!probes[SHEETS.CN]?.rows)
        tips.push("NCC_CongNo trống hoặc không có tab → công nợ thiếu phát sinh");
      if (!probes[SHEETS.NCC]?.rows)
        tips.push("DM_NCC trống → master NCC / tên NCC trên báo cáo kém");
      if (!probes[SHEETS.GM]?.rows)
        tips.push("DM_GiaMua trống → công nợ tính từ thực nhận × giá = 0");
      out.tips = tips;

      return jsonResponse(success(out));
    } catch (e: unknown) {
      out.connectError = String((e as Error)?.message || e).slice(0, 300);
      return jsonResponse(
        success({
          ...out,
          message: "Service Account không đọc được Spreadsheet (share quyền?)",
        })
      );
    }
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi debug"), 500);
  }
}
