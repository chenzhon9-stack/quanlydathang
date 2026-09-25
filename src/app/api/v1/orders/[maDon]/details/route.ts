import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ maDon: string }> };

/** POST /api/v1/orders/:maDon/details — Thêm xe (ADD_DETAIL) */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { maDon } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const result = await OrderService.addDetailsToOrder(
      decodeURIComponent(maDon),
      {
        year: body.year ? Number(body.year) : undefined,
        details: Array.isArray(body.details) ? body.details : [],
      },
      user
    );
    return jsonResponse(success(result), 201);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code === "NOT_FOUND")
      return jsonResponse(error(err.code, err.message || ""), 404);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi hệ thống"),
      500
    );
  }
}
