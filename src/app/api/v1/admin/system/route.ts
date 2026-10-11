import { NextRequest } from "next/server";
import { requireAdminVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import {
  getAdminStats,
  runAdminSystemAction,
  type AdminSystemAction,
} from "@/services/admin-system.service";
import { currentYearVN } from "@/lib/sheets/date";

/**
 * GET /api/v1/admin/system?year=2026  → stats cards
 * POST /api/v1/admin/system  { action, year?, days? }
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
    const year = Number(
      new URL(req.url).searchParams.get("year") || currentYearVN()
    );
    const data = await getAdminStats(year);
    return jsonResponse(success(data));
  } catch (e) {
    console.error("[admin/system GET]", e);
    return jsonResponse(error("INTERNAL", "Lỗi tải thống kê hệ thống"), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      year?: number;
      days?: number;
    };
    const action = String(body.action || "").trim() as AdminSystemAction;
    if (!action) {
      return jsonResponse(error("VALIDATION", "Thiếu action"), 400);
    }
    const result = await runAdminSystemAction(action, gate.user!, {
      year: body.year,
      days: body.days,
    });
    if (result && (result as { success?: boolean }).success === false) {
      return jsonResponse(
        error(
          "ADMIN_ACTION_FAILED",
          String((result as { error?: string }).error || "Thất bại")
        ),
        400
      );
    }
    return jsonResponse(success(result));
  } catch (e) {
    console.error("[admin/system POST]", e);
    const msg = e instanceof Error ? e.message : "Lỗi chạy lệnh bảo trì";
    return jsonResponse(error("INTERNAL", msg), 500);
  }
}
