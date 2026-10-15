import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { verifyRegisterOtp } from "@/services/register.service";

/** POST { email, otp } — bước 2: xác thực OTP → tạo User Pending */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await verifyRegisterOtp({
      email: String(body.email || ""),
      otp: String(body.otp || ""),
    });
    if (!r.success) {
      return jsonResponse(
        error("REGISTER_VERIFY_FAILED", r.error || "Xác thực thất bại"),
        400
      );
    }
    return jsonResponse(success({}, { message: r.message }));
  } catch (e) {
    console.error("[auth/register/verify]", e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
