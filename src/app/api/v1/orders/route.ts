import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

/** GET /api/v1/orders — STEP 5 listOrders */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { searchParams } = new URL(req.url);
    const filter = {
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
      year: searchParams.get("year")
        ? Number(searchParams.get("year"))
        : 2026,
      status: searchParams.get("status") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : 50,
    };

    const scope = resolveScope(user);
    const result = await OrderService.listOrders(filter, user, scope);

    // STEP 5.15 list shape
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
