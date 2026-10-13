import { NextRequest } from "next/server";
import { requireAdminVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import {
  listSystemProperties,
  upsertSystemProperty,
  deleteSystemProperty,
  updateGasSystemProperty,
} from "@/services/admin-system.service";
import { currentYearVN } from "@/lib/sheets/date";

/**
 * GET  /api/v1/admin/system/properties?year=
 *   → env (read-only) + GAS Script Properties + Sheet System_Config
 *
 * POST { key, value, ghiChu?, year?, source?: "sheet" | "gas" }
 *   source=sheet (default) → System_Config
 *   source=gas → GAS updateSystemProperty
 *
 * DELETE ?key=&year= → chỉ xóa dòng Sheet (không xóa GAS prop)
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
    const data = await listSystemProperties(year, gate.user!.email);
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
      source?: string;
    };
    const year = body.year ?? currentYearVN();
    const source = String(body.source || "sheet").toLowerCase();

    if (source === "gas") {
      const result = await updateGasSystemProperty(
        {
          key: String(body.key || ""),
          value: String(body.value ?? ""),
        },
        gate.user!
      );
      return jsonResponse(success(result));
    }

    const result = await upsertSystemProperty(
      {
        key: String(body.key || ""),
        value: String(body.value ?? ""),
        ghiChu: body.ghiChu,
      },
      gate.user!,
      year
    );
    return jsonResponse(success({ ...result, source: "sheet" }));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code) {
      const status =
        err.code === "NOT_FOUND"
          ? 404
          : err.code === "GAS_NOT_CONFIGURED" || err.code === "GAS_PROP_FAILED"
            ? 502
            : 400;
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
