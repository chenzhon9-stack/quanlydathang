import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { DeliveryService } from "@/services/delivery.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/v1/order-details/:id/real — Lưu thực giao batch (V21 saveDeliveryData realMode) */
export async function PUT(req: NextRequest, ctx: Ctx) {
  let detailId = "";
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { id } = await ctx.params;
    detailId = decodeURIComponent(id);
    const body = await req.json().catch(() => ({}));
    const year = body.year ? Number(body.year) : new Date().getFullYear();
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const options = {
      confirmFinish: !!body.confirmFinish || !!body.confirm,
      adminOverride: !!body.adminOverride,
    };
    const result = await DeliveryService.saveReal(
      detailId,
      rows,
      options,
      user,
      year
    );
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as {
      code?: string;
      message?: string;
      needConfirm?: boolean;
      meta?: unknown;
    };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code === "NEED_CONFIRM") {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "NEED_CONFIRM",
            message: err.message || "Cần xác nhận",
            needConfirm: true,
            meta: err.meta,
          },
        },
        400
      );
    }
    if (err?.code) {
      console.warn("[order-details/real]", err.code, err.message, {
        id: detailId || undefined,
      });
      return jsonResponse(error(err.code, err.message || ""), 400);
    }
    console.error("[order-details/real] unexpected", e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
