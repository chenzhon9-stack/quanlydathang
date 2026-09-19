import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSheetsConfigured, getSpreadsheetId } from "@/lib/sheets/client";
import { getSheetsClient } from "@/lib/sheets/client";
import { SHEETS } from "@/lib/sheets/constants";
import { success, error, jsonResponse } from "@/lib/api";

/**
 * GET /api/v1/debug/sheets — chẩn đoán kết nối + header DonHang
 * Chỉ ADMIN (hoặc khi đã login). Không trả private key.
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

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
    };

    if (!configured) {
      return jsonResponse(
        success({
          ...out,
          message: "Thiếu env Service Account — app đang dùng mock",
        })
      );
    }

    try {
      const sheets = getSheetsClient();
      const spreadsheetId = getSpreadsheetId(2026);

      // list sheet tab names
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties.title",
      });
      const tabNames =
        meta.data.sheets?.map((s) => s.properties?.title || "") || [];
      out.workbookTitle = meta.data.properties?.title;
      out.tabs = tabNames;
      out.hasDonHang = tabNames.includes(SHEETS.DH);

      // read first rows of DonHang
      if (tabNames.includes(SHEETS.DH)) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${SHEETS.DH}!A1:L5`,
          valueRenderOption: "FORMATTED_STRING",
        });
        const values = res.data.values || [];
        out.donHangHeader = values[0] || [];
        out.donHangSampleRows = values.slice(1, 4);
        out.donHangRowCountHint = values.length - 1;
      } else {
        out.donHangError = `Không có tab tên đúng "${SHEETS.DH}". Tabs: ${tabNames.join(", ")}`;
      }
    } catch (e: unknown) {
      const err = e as { message?: string; code?: number };
      out.sheetsApiError = err?.message || String(e);
      out.sheetsApiCode = err?.code;
    }

    return jsonResponse(success(out));
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi debug"), 500);
  }
}
