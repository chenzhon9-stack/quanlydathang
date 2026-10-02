import { NextRequest } from "next/server";
import { getCurrentUserVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";

/**
 * GET /api/v1/auth/me
 * Kiểm tra session còn hiệu lực (Locked / đổi MK → 401 SESSION_REVOKED).
 */
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const user = await getCurrentUserVerified(token);

  if (!user) {
    return jsonResponse(
      error(
        "SESSION_REVOKED",
        "Phiên đăng nhập hết hạn hoặc tài khoản đã bị khóa / đổi mật khẩu. Vui lòng đăng nhập lại."
      ),
      401
    );
  }

  return jsonResponse(success({ user, permissions: user.permissions }));
}
