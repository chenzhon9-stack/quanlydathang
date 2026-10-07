import { NextRequest } from "next/server";
import { getCurrentUser, getCurrentUserVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { MasterService } from "@/services/master.service";
import { getMasterSchemaPublic, MASTER_TYPES } from "@/lib/master-config";

/**
 * GET /api/v1/masters?type=NCC
 * POST /api/v1/masters  body: { type, row }
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const user = getCurrentUser(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }

    const type = (req.nextUrl.searchParams.get("type") || "NCC").toUpperCase();
    const schemaOnly = req.nextUrl.searchParams.get("schema") === "1";

    if (schemaOnly) {
      const schema = getMasterSchemaPublic(type);
      if (!schema) {
        return jsonResponse(
          error(
            "VALIDATION_ERROR",
            `type phải là: ${MASTER_TYPES.join(", ")}`
          ),
          400
        );
      }
      return jsonResponse(success({ schema }));
    }

    const data = await MasterService.list(type, user);
    return jsonResponse(success(data));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error("[masters GET]", e);
    return jsonResponse(
      error(err.code || "INTERNAL_ERROR", err.message || "Lỗi master"),
      err.code === "UNAUTHORIZED" ? 401 : 500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const user = await getCurrentUserVerified(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }

    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "").toUpperCase();
    const row = (body.row || body.data || {}) as Record<string, unknown>;

    const result = await MasterService.save(type, row, user);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error("[masters POST]", e);
    const status =
      err.code === "PERMISSION_DENIED"
        ? 403
        : err.code === "VALIDATION_ERROR"
          ? 400
          : err.code === "UNAUTHORIZED"
            ? 401
            : 500;
    return jsonResponse(
      error(err.code || "INTERNAL_ERROR", err.message || "Lỗi lưu danh mục"),
      status
    );
  }
}
