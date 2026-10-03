import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { FinanceService } from "@/services/finance.service";
import { success, error, jsonResponse } from "@/lib/api";
import { currentYearVN } from "@/lib/sheets/date";

/** POST /api/v1/finance/opening/:id/void — hủy dư đầu năm */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const year = Number(body.year || currentYearVN());
    const result = await FinanceService.voidOpening(id, user, year);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
