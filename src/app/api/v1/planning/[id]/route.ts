import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { PlanningService } from "@/services/planning.service";
import { success, error, jsonResponse } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const { id } = await ctx.params;
    const year = req.nextUrl.searchParams.get("year")
      ? Number(req.nextUrl.searchParams.get("year"))
      : undefined;
    const scope = resolveScope(user);
    const result = await PlanningService.getPlan(id, user, scope, year);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const status =
      err?.code === "PERMISSION_DENIED"
        ? 403
        : err?.code === "NOT_FOUND"
          ? 404
          : 400;
    if (err?.code) return jsonResponse(error(err.code, err.message || ""), status);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const { id } = await ctx.params;
    const body = await req.json();
    const year = body?.year ? Number(body.year) : undefined;
    const result = await PlanningService.updatePlan(id, body || {}, user, year);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const status = err?.code === "PERMISSION_DENIED" ? 403 : 400;
    if (err?.code) return jsonResponse(error(err.code, err.message || ""), status);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const { id } = await ctx.params;
    const year = req.nextUrl.searchParams.get("year")
      ? Number(req.nextUrl.searchParams.get("year"))
      : undefined;
    const result = await PlanningService.cancelPlan(id, user, year);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const status = err?.code === "PERMISSION_DENIED" ? 403 : 400;
    if (err?.code) return jsonResponse(error(err.code, err.message || ""), status);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
