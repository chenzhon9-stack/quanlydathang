import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MasterRepository } from "@/repositories/master.repository";
import { success, error, jsonResponse } from "@/lib/api";
import { STANDARD_HEADERS, SHEETS } from "@/lib/sheets/constants";

const TYPES = ["NCC", "KH", "HH", "XE", "HTVT", "DVT", "KV", "NCC_HH"] as const;

export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const type = (req.nextUrl.searchParams.get("type") || "NCC").toUpperCase();
    if (!TYPES.includes(type as (typeof TYPES)[number])) {
      return jsonResponse(
        error("VALIDATION_ERROR", `type phải là: ${TYPES.join(", ")}`),
        400
      );
    }

    const rows = await MasterRepository.list(type);
    const sheetKey =
      type === "NCC"
        ? SHEETS.NCC
        : type === "KH"
          ? SHEETS.KH
          : type === "HH"
            ? SHEETS.HH
            : type === "XE"
              ? SHEETS.XE
              : type === "HTVT"
                ? SHEETS.HTVT
                : type === "DVT"
                  ? SHEETS.DVT
                  : type === "KV"
                    ? SHEETS.KV
                    : SHEETS.NCC_HH;
    const headers = STANDARD_HEADERS[sheetKey] || (rows[0] ? Object.keys(rows[0]) : []);

    return jsonResponse(
      success({
        type,
        headers,
        items: rows,
        total: rows.length,
      })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi master"), 500);
  }
}
