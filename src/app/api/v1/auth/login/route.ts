import { NextRequest } from "next/server";
import { login } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body || {};

    if (!email || !password) {
      return jsonResponse(
        error("VALIDATION_ERROR", "Email và mật khẩu là bắt buộc"),
        400
      );
    }

    const result = login(String(email).toLowerCase(), String(password));
    if (!result) {
      return jsonResponse(
        error("AUTH_INVALID", "Email hoặc mật khẩu không đúng"),
        401
      );
    }

    return jsonResponse(
      success({
        user: result.user,
        session: {
          token: result.token,
          expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        },
      })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
