import { NextRequest } from "next/server";
import { requireAdminVerified } from "@/lib/auth";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import {
  sheetCacheStats,
  invalidateSheetCache,
} from "@/lib/sheets/sheet-cache";
import { success, error, jsonResponse } from "@/lib/api";

/**
 * GET /api/v1/debug/sheet-cache
 *   ?probe=1&year=2026  → đọc CT + GH 2 lần, đo ms (MISS rồi HIT)
 *   ?clear=1            → xóa toàn bộ cache
 *
 * Chỉ Admin (session verified).
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || new Date().getFullYear());
    const clear = searchParams.get("clear") === "1";
    const probe = searchParams.get("probe") === "1";

    if (clear) {
      invalidateSheetCache();
    }

    const statsBefore = sheetCacheStats();

    if (!probe) {
      return jsonResponse(
        success({
          sheetsConfigured: isSheetsConfigured(),
          ttlMs: Number(process.env.SHEET_CACHE_TTL_MS || 45000),
          cache: statsBefore,
          hint: "Thêm ?probe=1&year=2026 để đo 2 lần đọc CT+GH (MISS→HIT)",
        })
      );
    }

    if (!isSheetsConfigured()) {
      return jsonResponse(
        error("SHEETS_NOT_CONFIGURED", "Chưa cấu hình Sheets"),
        400
      );
    }

    // Ép MISS
    invalidateSheetCache([SHEETS.CT, SHEETS.GH, SHEETS.DH], year);

    const t0 = Date.now();
    const ct1 = await readSheetAsObjects(SHEETS.CT, { year });
    const gh1 = await readSheetAsObjects(SHEETS.GH, { year });
    const missMs = Date.now() - t0;

    const t1 = Date.now();
    const ct2 = await readSheetAsObjects(SHEETS.CT, { year });
    const gh2 = await readSheetAsObjects(SHEETS.GH, { year });
    const hitMs = Date.now() - t1;

    return jsonResponse(
      success({
        year,
        rows: {
          CT: ct1.length,
          GH: gh1.length,
          CT2: ct2.length,
          GH2: gh2.length,
        },
        timing: {
          missMs,
          hitMs,
          speedup:
            hitMs > 0 ? Number((missMs / hitMs).toFixed(1)) : missMs > 0 ? "∞" : 1,
        },
        cacheAfter: sheetCacheStats(),
        note: "missMs = đọc Sheets API; hitMs = từ RAM instance này",
      })
    );
  } catch (e: unknown) {
    console.error(e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
