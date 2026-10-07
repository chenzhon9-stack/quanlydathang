import { NextRequest } from "next/server";
import { getCurrentUserVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { MasterService } from "@/services/master.service";

type Ctx = { params: Promise<{ type: string; key: string }> };

/**
 * PATCH /api/v1/masters/:type/:key  body: { action: "toggle" } | full row update
 * DELETE /api/v1/masters/:type/:key  soft-delete (HoatDong=false)
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const user = await getCurrentUserVerified(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }

    const { type, key: rawKey } = await ctx.params;
    const key = decodeURIComponent(rawKey || "").trim();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").toLowerCase();

    if (action === "toggle") {
      const result = await MasterService.toggle(type, key, user);
      return jsonResponse(success(result));
    }

    // Full update: merge known key into row
    const { getMasterConfig } = await import("@/lib/master-config");
    const cfg = getMasterConfig(type);
    const keyField = cfg?.key || "id";
    const row = { ...(body.row || body), [keyField]: key };
    const result = await MasterService.save(type, row, user);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error("[masters PATCH]", e);
    const status =
      err.code === "PERMISSION_DENIED"
        ? 403
        : err.code === "NOT_FOUND"
          ? 404
          : err.code === "VALIDATION_ERROR"
            ? 400
            : 500;
    return jsonResponse(
      error(err.code || "INTERNAL_ERROR", err.message || "Lỗi cập nhật"),
      status
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const user = await getCurrentUserVerified(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }

    const { type, key: rawKey } = await ctx.params;
    const key = decodeURIComponent(rawKey || "").trim();
    const result = await MasterService.remove(type, key, user);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error("[masters DELETE]", e);
    const status =
      err.code === "PERMISSION_DENIED"
        ? 403
        : err.code === "NOT_FOUND"
          ? 404
          : err.code === "VALIDATION_ERROR"
            ? 400
            : 500;
    return jsonResponse(
      error(err.code || "INTERNAL_ERROR", err.message || "Lỗi xóa"),
      status
    );
  }
}
