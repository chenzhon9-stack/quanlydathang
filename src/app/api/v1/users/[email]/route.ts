import { NextRequest } from "next/server";
import { getCurrentUserVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { updateSheetRowByKey, appendSheetRow } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { normalizeRole } from "@/lib/permissions";
import { writeAudit } from "@/lib/sheets/audit";

type Ctx = { params: Promise<{ email: string }> };

async function requireAdmin(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const user = await getCurrentUserVerified(token);
  if (!user)
    return {
      error: jsonResponse(
        error(
          "SESSION_REVOKED",
          "Phiên hết hạn hoặc tài khoản đã khóa / đổi mật khẩu"
        ),
        401
      ),
    };
  if (user.role !== "ADMIN" && !user.permissions.includes("*")) {
    return {
      error: jsonResponse(error("PERMISSION_DENIED", "Chỉ ADMIN"), 403),
    };
  }
  return { user };
}

/**
 * PATCH /api/v1/users/:email
 * Cập nhật Role, Quanly, HoatDong, TrangThai, hồ sơ.
 * V21: Admin KHÔNG được đặt Password — user tự đổi qua OTP (Quên/Đổi mật khẩu).
 * Khóa user → session JWT cũ bị revoke.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const gate = await requireAdmin(req);
    if (gate.error) return gate.error;

    if (!isSheetsConfigured()) {
      return jsonResponse(
        error("SHEETS_NOT_CONFIGURED", "Chưa cấu hình Sheet"),
        400
      );
    }

    const { email: rawEmail } = await ctx.params;
    const email = decodeURIComponent(rawEmail).trim().toLowerCase();
    const body = await req.json();

    // Chặn admin đặt MK hộ (parity V21 — cột Password không editable)
    const attemptedPw = body.password ?? body.matKhau ?? body.newPassword;
    if (attemptedPw !== undefined && String(attemptedPw).trim() !== "") {
      return jsonResponse(
        error(
          "FORBIDDEN",
          "Mật khẩu do chính user đặt/đổi (Quên/Đổi mật khẩu + OTP). Admin không đặt hộ."
        ),
        403
      );
    }

    const patch: Record<string, string | boolean> = {};
    if (body.role !== undefined) {
      patch.Role = normalizeRole(String(body.role));
    }
    if (body.quanly !== undefined) patch.Quanly = String(body.quanly);
    if (body.hoTen !== undefined) patch.HoTen = String(body.hoTen);
    if (body.phongBan !== undefined) patch.PhongBan = String(body.phongBan);
    if (body.dienThoai !== undefined) patch.DienThoai = String(body.dienThoai);
    if (body.active !== undefined) {
      patch.HoatDong = Boolean(body.active);
      if (body.active === false && body.trangThai === undefined) {
        patch.TrangThai = "Locked";
      }
      if (body.active === true && body.trangThai === undefined) {
        patch.TrangThai = "Approved";
      }
    }
    if (body.trangThai !== undefined) patch.TrangThai = String(body.trangThai);

    if (!Object.keys(patch).length) {
      return jsonResponse(
        error("VALIDATION_ERROR", "Không có field cập nhật"),
        400
      );
    }

    const row = await updateSheetRowByKey(SHEETS.USER, "Email", email, patch);
    if (row < 0) {
      return jsonResponse(error("USER_NOT_FOUND", "Không tìm thấy user"), 404);
    }

    const revoked =
      patch.TrangThai === "Locked" || patch.HoatDong === false;

    await writeAudit({
      email: gate.user!.email,
      role: gate.user!.role,
      action: revoked ? "USER_REVOKE_SESSIONS" : "USER_UPDATE",
      targetId: email,
      newValue: patch,
      lyDo: revoked
        ? `Admin khóa/cập nhật user ${email} — revoke session`
        : `Admin cập nhật user ${email}`,
    });

    if (patch.Role) {
      try {
        await appendSheetRow(SHEETS.USER_ROLES, {
          Email: email,
          RoleCode: String(patch.Role),
          HoatDong: true,
          Source: "ADMIN_UI",
          UpdatedAt: new Date().toISOString(),
          UpdatedBy: gate.user!.email,
        });
      } catch (e) {
        console.info("[Admin] UserRoles append skip", e);
      }
    }

    return jsonResponse(
      success(
        { email, patch: { ...patch, Password: patch.Password ? "(set)" : undefined }, row, sessionsRevoked: revoked },
        {
          message: revoked
            ? "Đã cập nhật User — phiên đăng nhập cũ của user này đã vô hiệu"
            : "Đã cập nhật User",
        }
      )
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
