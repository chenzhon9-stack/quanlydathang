import { NextRequest } from "next/server";
import { requireAdminVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import {
  listSystemProperties,
  upsertSystemProperty,
  deleteSystemProperty,
} from "@/services/admin-system.service";
import { currentYearVN } from "@/lib/sheets/date";

/**
 * GET  /api/v1/admin/system/properties?year=
 * POST { key, value, ghiChu?, year? } — thêm/sửa sheet System_Config
 * DELETE ?key=&year= — xóa (clear) dòng sheet
 *
 * Env Vercel chỉ hiển thị mask, không ghi được từ app.
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }
    const year = Number(
      new URL(req.url).searchParams.get("year") || currentYearVN()
    );
    const data = await listSystemProperties(year);
    return jsonResponse(success(data));
  } catch (e) {
    console.error("[admin/system/properties GET]", e);
    return jsonResponse(error("INTERNAL", "Lỗi tải properties"), 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      key?: string;
      value?: string;
      ghiChu?: string;
      year?: number;
    };
    const year = body.year ?? currentYearVN();
    const result = await upsertSystemProperty(
      {
        key: String(body.key || ""),
        value: String(body.value ?? ""),
        ghiChu: body.ghiChu,
      },
      gate.user!,
      year
    );
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code) {
      const status =
        err.code === "NOT_FOUND" ? 404 : err.code === "VALIDATION" ? 400 : 400;
      return jsonResponse(error(err.code, err.message || ""), status);
    }
    console.error("[admin/system/properties POST]", e);
    return jsonResponse(error("INTERNAL", "Lỗi lưu property"), 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }
    const sp = new URL(req.url).searchParams;
    const key = sp.get("key") || "";
    const year = Number(sp.get("year") || currentYearVN());
    const result = await deleteSystemProperty(key, gate.user!, year);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return jsonResponse(error(err.code, err.message || ""), status);
    }
    console.error("[admin/system/properties DELETE]", e);
    return jsonResponse(error("INTERNAL", "Lỗi xóa property"), 500);
  }
}
