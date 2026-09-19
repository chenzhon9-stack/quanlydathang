import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

/** GET /api/v1/orders/:maDon */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ maDon: string }> }
) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { maDon } = await ctx.params;
    const year = new URL(req.url).searchParams.get("year");
    const scope = resolveScope(user);
    const order = await OrderService.getOrder(
      decodeURIComponent(maDon),
      user,
      scope,
      year ? Number(year) : 2026
    );
    return jsonResponse(success(order));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "ORDER_NOT_FOUND")
      return jsonResponse(error(err.code, err.message || ""), 404);
    if (err?.code === "PERMISSION_DENIED" || err?.code === "SCOPE_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
