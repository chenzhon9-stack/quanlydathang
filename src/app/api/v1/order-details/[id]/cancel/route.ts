import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { DetailService } from "@/services/detail.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/order-details/:id/cancel — Hủy/Xóa xe */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "delete" ? "delete" : "cancel";
    const year = body.year ? Number(body.year) : new Date().getFullYear();
    const result = await DetailService.cancelDetail(
      decodeURIComponent(id),
      mode,
      user,
      year
    );
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code === "NOT_FOUND")
      return jsonResponse(error(err.code, err.message || ""), 404);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
