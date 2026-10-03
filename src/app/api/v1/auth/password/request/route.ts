import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { requestPasswordReset } from "@/services/password.service";

/** POST { email } — V21 requestPasswordReset (không leak email tồn tại) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim();
    if (!email || !email.includes("@")) {
      return jsonResponse(
        error("VALIDATION_ERROR", "Email không hợp lệ."),
        400
      );
    }
    const r = await requestPasswordReset(email);
    if (!r.success && r.error && /quá nhiều/i.test(r.error)) {
      return jsonResponse(error("RATE_LIMIT", r.error), 429);
    }
    if (!r.success && r.error && /Sheets|cấu hình/i.test(r.error)) {
      return jsonResponse(error("SHEETS_NOT_CONFIGURED", r.error), 400);
    }
    const msg =
      r.message ||
      "Nếu email tồn tại, mã OTP đã được gửi (hiệu lực 15 phút).";
    return jsonResponse(success({ message: msg }, { message: msg }));
  } catch (e) {
    console.error("[auth/password/request]", e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
