import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { ReportService } from "@/services/report.service";
import { success, error, jsonResponse } from "@/lib/api";

/**
 * GET /api/v1/finance/payables/detail?supplierId=NCC01&fromDate=&toDate=&year=
 * Sổ chi tiết công nợ 1 NCC — dùng query (tránh 404 dynamic [id] trên một số deploy).
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const sp = req.nextUrl.searchParams;
    const supplierId = String(
      sp.get("supplierId") || sp.get("maNcc") || sp.get("id") || ""
    ).trim();
    if (!supplierId) {
      return jsonResponse(
        error("VALIDATION_ERROR", "Thiếu supplierId (MaNCC)"),
        400
      );
    }

    const scope = resolveScope(user);
    const result = await ReportService.getPayablesDetail(
      supplierId,
      {
        fromDate: sp.get("fromDate") || undefined,
        toDate: sp.get("toDate") || undefined,
        year: sp.get("year") ? Number(sp.get("year")) : undefined,
      },
      user,
      scope
    );
    return jsonResponse(success(result.data, result.meta));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error("[payables/detail]", e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi"), 500);
  }
}
