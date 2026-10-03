import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { FinanceService } from "@/services/finance.service";
import { success, error, jsonResponse } from "@/lib/api";
import { currentYearVN } from "@/lib/sheets/date";

/**
 * GET /api/v1/finance/payables
 * Sổ phát sinh CN (listCongNoPhatSinh)
 * Query: fromDate, toDate, maNcc, loai, onlyActive, year
 */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const scope = resolveScope(user);
    const sp = new URL(req.url).searchParams;
    const maNccRaw = sp.getAll("maNcc").length
      ? sp.getAll("maNcc")
      : sp.get("maNcc")
        ? String(sp.get("maNcc"))
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
    const loaiRaw = sp.getAll("loai").length
      ? sp.getAll("loai")
      : sp.get("loai")
        ? String(sp.get("loai"))
            .split(/[;,]/)
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
    const result = await FinanceService.listPayableEntries(
      {
        fromDate: sp.get("fromDate") || undefined,
        toDate: sp.get("toDate") || undefined,
        maNcc: maNccRaw.length ? maNccRaw : undefined,
        loai: loaiRaw.length ? loaiRaw : undefined,
        onlyActive: sp.get("onlyActive") !== "false",
        year: Number(sp.get("year") || currentYearVN()),
      },
      user,
      scope
    );
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED" || err?.code === "SCOPE_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}

/** POST /api/v1/finance/payables — ghi chứng từ CN thủ công */
export async function POST(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const scope = resolveScope(user);
    const body = await req.json().catch(() => ({}));
    const result = await FinanceService.createPayableEntry(body, user, scope);
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED" || err?.code === "SCOPE_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
