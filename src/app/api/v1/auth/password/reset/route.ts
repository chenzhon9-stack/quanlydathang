import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { resetPasswordWithOtp } from "@/services/password.service";

/** POST { email, otp, newPassword, confirmPassword } — V21 resetPasswordWithOtp */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await resetPasswordWithOtp({
      email: String(body.email || ""),
      otp: String(body.otp || ""),
      newPassword: String(body.newPassword || body.password || ""),
      confirmPassword: String(
        body.confirmPassword || body.password2 || body.newPassword || ""
      ),
    });
    if (!r.success) {
      return jsonResponse(error("VALIDATION_ERROR", r.error || "Lỗi"), 400);
    }
    return jsonResponse(
      success({ message: r.message }, { message: r.message })
    );
  } catch (e) {
    console.error("[auth/password/reset]", e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
