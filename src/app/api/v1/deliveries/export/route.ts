import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { DeliveryService } from "@/services/delivery.service";
import { success, error, jsonResponse } from "@/lib/api";

export const maxDuration = 60;

/**
 * Xuất Excel Giao hàng — parity V21 getDeliveries(email, { fromDate, toDate, export:true }).
 * Không phân trang; mặc định 30 ngày nếu thiếu from/to; cùng scope/quyền với danh sách.
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { searchParams } = new URL(req.url);
    const scope = resolveScope(user);
    const dateFieldRaw = (searchParams.get("dateField") || "order").toLowerCase();
    const result = await DeliveryService.exportDeliveries(
      {
        fromDate: searchParams.get("fromDate") || undefined,
        toDate: searchParams.get("toDate") || undefined,
        dateField: dateFieldRaw === "delivery" ? "delivery" : "order",
      },
      user,
      scope
    );
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
