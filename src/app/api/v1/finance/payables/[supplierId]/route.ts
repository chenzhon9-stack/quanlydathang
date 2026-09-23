import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { ReportService } from "@/services/report.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ supplierId: string }> };

/** GET /api/v1/finance/payables/:supplierId?fromDate&toDate — chi tiết sổ */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { supplierId: raw } = await ctx.params;
    const supplierId = decodeURIComponent(raw);
    const sp = req.nextUrl.searchParams;
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
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi"), 500);
  }
}
