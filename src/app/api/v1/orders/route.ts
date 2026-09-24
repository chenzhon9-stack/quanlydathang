import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { OrderService } from "@/services/order.service";
import { success, error, jsonResponse } from "@/lib/api";

/** GET /api/v1/orders — listOrders */
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
        : new Date().getFullYear(),
      status: searchParams.get("status") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : 50,
    };

    const scope = resolveScope(user);
    const result = await OrderService.listOrders(filter, user, scope);
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

/** POST /api/v1/orders — createOrder (V21 saveFullNewOrder) */
export async function POST(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const body = await req.json().catch(() => ({}));
    const result = await OrderService.createOrder(
      {
        supplierId: body.supplierId || body.maNcc || "",
        orderDate: body.orderDate || body.ngayDatHang,
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
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi hệ thống"),
      500
    );
  }
}
