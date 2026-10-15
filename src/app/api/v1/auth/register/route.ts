import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { registerUser } from "@/services/register.service";

/** POST { email, password, confirmPassword, hoTen, dienThoai?, phongBan? } — public */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const r = await registerUser({
      email: String(body.email || ""),
      password: String(body.password || ""),
      confirmPassword: String(body.confirmPassword || body.password2 || ""),
      hoTen: String(body.hoTen || body.name || ""),
      dienThoai: String(body.dienThoai || body.phone || ""),
      phongBan: String(body.phongBan || body.department || ""),
    });
    if (!r.success) {
      return jsonResponse(
        error("REGISTER_FAILED", r.error || "Đăng ký thất bại"),
        400
      );
    }
    return jsonResponse(
      success({ email: String(body.email || "").trim().toLowerCase() }, {
        message: r.message,
      })
    );
  } catch (e) {
    console.error("[auth/register]", e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
