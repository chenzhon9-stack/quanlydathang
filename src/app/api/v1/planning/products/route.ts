import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PlanningService } from "@/services/planning.service";
import { success, error, jsonResponse } from "@/lib/api";

/** GET /api/v1/planning/products?supplierId= */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const supplierId = req.nextUrl.searchParams.get("supplierId") || "";
    if (!supplierId)
      return jsonResponse(error("VALIDATION_ERROR", "Thiếu supplierId"), 400);
    const items = await PlanningService.productsForSupplier(supplierId);
    return jsonResponse(success({ items }));
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi"), 500);
  }
}
