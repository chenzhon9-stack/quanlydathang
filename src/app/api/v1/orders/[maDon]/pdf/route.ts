import { NextRequest } from "next/server";
import { getCurrentUserVerified, hasPermission } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { gasCreateOrderPdf } from "@/lib/gas-pdf";
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { currentYearVN } from "@/lib/sheets/date";

type Ctx = { params: Promise<{ maDon: string }> };

/**
 * POST /api/v1/orders/:maDon/pdf
 * Phase A Hybrid (D152): chỉ tạo PDF qua GAS — KHÔNG tăng LanGui.
 * Body optional: { saveFileDonhang?: boolean } — ghi FileDonhang (D153 partial, không LanGui).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const user = await getCurrentUserVerified(token);
    if (!user) {
      return jsonResponse(error("UNAUTHORIZED", "Chưa đăng nhập"), 401);
    }
    if (!hasPermission(user, "ORDER_SEND") && !hasPermission(user, "*")) {
      return jsonResponse(
        error("PERMISSION_DENIED", "Không có quyền tạo PDF đơn"),
        403
      );
    }
    const { maDon: raw } = await ctx.params;
    const maDon = decodeURIComponent(raw || "").trim();
    if (!maDon) {
      return jsonResponse(error("VALIDATION_ERROR", "Thiếu mã đơn"), 400);
    }

    let saveFile = false;
    try {
      const body = await req.json();
      saveFile = !!(body && body.saveFileDonhang);
    } catch {
      /* no body */
    }

    const year = currentYearVN();
    const pdf = await gasCreateOrderPdf(maDon, { year });
    if (!pdf.ok) {
      return jsonResponse(
        error("GAS_PDF_FAILED", pdf.error),
        502
      );
    }

    if (saveFile && pdf.pdfUrl) {
      // D153: chỉ FileDonhang — KHÔNG LanGui++
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        maDon,
        { FileDonhang: pdf.pdfUrl },
        year
      ).catch(() => null);
    }

    return jsonResponse(
      success({
        orderId: maDon,
        pdfUrl: pdf.pdfUrl,
        pdfFileId: pdf.pdfFileId,
        fileName: pdf.fileName,
        lanGuiChanged: false,
        message:
          "Đã tạo PDF (createPdf). LanGui không đổi. Gửi Email/Zalo vẫn qua GAS sendOrderEmail (D151).",
      })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
