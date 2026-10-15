import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { resendRegisterOtp } from "@/services/register.service";

/** POST { email } — gửi lại OTP đăng ký */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await resendRegisterOtp(String(body.email || ""));
    if (!r.success) {
      return jsonResponse(
        error("REGISTER_RESEND_FAILED", r.error || "Không gửi lại được OTP"),
        400
      );
    }
    return jsonResponse(success({}, { message: r.message }));
  } catch (e) {
    console.error("[auth/register/resend]", e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
