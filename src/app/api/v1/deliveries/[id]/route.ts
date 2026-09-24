import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { DeliveryService } from "@/services/delivery.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/deliveries/:id — Cập nhật thực giao (V21 rules) */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const year = body.year ? Number(body.year) : new Date().getFullYear();
    const result = await DeliveryService.updateDelivery(
      decodeURIComponent(id),
      {
        actualQty: Number(body.actualQty ?? body.thucGiao),
        deliveryDate: body.deliveryDate || body.ngayGiao,
        note: body.note || body.ghiChu,
        customerId: body.customerId || body.maKh,
        customerDetail: body.customerDetail || body.chitietKh,
        confirm: !!body.confirm,
      },
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
    if (err?.code === "NOT_FOUND")
      return jsonResponse(error(err.code, err.message || ""), 404);
    if (err?.code === "NEED_CONFIRM") {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "NEED_CONFIRM",
            message: err.message || "Cần xác nhận",
            needConfirm: err.needConfirm !== false,
            meta: err.meta,
          },
        },
        409
      );
    }
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
