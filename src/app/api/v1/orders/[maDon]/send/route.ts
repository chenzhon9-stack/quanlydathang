import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ maDon: string }> };

/** POST /api/v1/orders/:maDon/send — body: { year?, sendAction?: ''|'send'|'reset'|'cancel'|'markSent' } */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }
    const { maDon } = await ctx.params;
    let year: number | undefined;
    let sendAction = "";
    try {
      const body = await req.json();
      if (body?.year) year = Number(body.year);
      if (body?.sendAction != null) sendAction = String(body.sendAction);
      if (body?.action && body.action !== "sendOrderEmail") {
        // tương thích action = send|reset|cancel|markSent
        const a = String(body.action);
        if (["send", "reset", "cancel", "markSent", ""].includes(a)) sendAction = a;
      }
    } catch {
      /* empty body */
    }
    const data = await OrderService.sendOrder(maDon, user, year, sendAction);
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
      error(err.code || "SEND_ORDER_FAILED", err.message || String(e)),
      status
    );
  }
}
