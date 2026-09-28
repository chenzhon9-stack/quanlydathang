import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ maDon: string }> };

/**
 * POST /api/v1/orders/:maDon/reset-duyen-ha
 * Reset đơn hàng (mọi NCC) — ràng buộc thời gian V21:
 * - Chưa gửi (LanGui=0): ≥ 1 ngày nghiệp vụ
 * - Đã gửi: ≥ 1 ngày (Duyên Hà) hoặc ≥ 2 ngày (đơn thường)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }
    const { maDon } = await ctx.params;
    const orderId = decodeURIComponent(maDon || "");
    let year: number | undefined;
    try {
      const body = await req.json();
      if (body?.year) year = Number(body.year);
    } catch {
      /* empty */
    }
    const data = await OrderService.resetOrder(orderId, user, year);
    return jsonResponse(success(data));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const status =
      err.code === "PERMISSION_DENIED"
        ? 403
        : err.code === "NOT_FOUND"
          ? 404
          : 400;
    return jsonResponse(
      error(err.code || "RESET_FAILED", err.message || String(e)),
      status
    );
  }
}
