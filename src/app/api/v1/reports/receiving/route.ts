import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { ReportService } from "@/services/report.service";
import { success, error, jsonResponse } from "@/lib/api";

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
        : undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : 50,
    };

    const scope = resolveScope(user);
    const result = await ReportService.getReceiving(filter, user, scope);
    return jsonResponse(success(result.data, result.meta));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 403);
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
