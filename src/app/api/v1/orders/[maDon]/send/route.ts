import { NextRequest } from "next/server";
import { requireVerifiedUser } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ maDon: string }> };

/** POST /api/v1/orders/:maDon/send — body: { year?, sendAction?, resend? } */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    // Verified: khóa user / đổi MK → không gửi được (D148+)
    const user = await requireVerifiedUser(req);
    if (!user) {
      return jsonResponse(
        error("SESSION_REVOKED", "Phiên không hợp lệ hoặc đã bị thu hồi"),
        401
      );
    }
    const { maDon } = await ctx.params;
    const orderId = decodeURIComponent(maDon || "");
    let year: number | undefined;
    let sendAction = "";
    let resend = false;
    try {
      const body = await req.json();
      if (body?.year) year = Number(body.year);
      if (body?.sendAction != null) sendAction = String(body.sendAction);
      if (body?.action) {
        const a = String(body.action);
        if (["send", "reset", "cancel", "markSent", ""].includes(a))
          sendAction = a;
      }
      if (body?.resend === true || body?.resend === "true") resend = true;
    } catch {
      /* empty body */
    }
    const data = await OrderService.sendOrder(orderId, user, year, sendAction, {
      resend,
    });
    return jsonResponse(success(data));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; gas?: unknown };
    console.error("[send route]", err.code, err.message, err.gas);
    const status =
      err.code === "PERMISSION_DENIED"
        ? 403
        : err.code === "NOT_FOUND"
          ? 404
          : err.code === "UNAUTHORIZED" || err.code === "SESSION_REVOKED"
            ? 401
            : 400;
    return jsonResponse(
      error(err.code || "SEND_ORDER_FAILED", err.message || String(e)),
      status
    );
  }
}
