import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { requestRegisterOtp } from "@/services/register.service";

/** POST — bước 1: gửi OTP đăng ký (chưa tạo User) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await requestRegisterOtp({
      email: String(body.email || ""),
      password: String(body.password || ""),
      confirmPassword: String(body.confirmPassword || body.password2 || ""),
      hoTen: String(body.hoTen || body.name || ""),
      dienThoai: String(body.dienThoai || body.phone || ""),
      phongBan: String(body.phongBan || body.department || ""),
    });
    if (!r.success) {
      return jsonResponse(
        error("REGISTER_OTP_FAILED", r.error || "Không gửi được OTP"),
        400
      );
    }
    return jsonResponse(
      success(
        { email: String(body.email || "").trim().toLowerCase(), step: "otp" },
        { message: r.message }
      )
    );
  } catch (e) {
    console.error("[auth/register]", e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
