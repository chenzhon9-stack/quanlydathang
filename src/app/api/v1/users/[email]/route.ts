import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { getCurrentUserVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { updateSheetRowByKey, appendSheetRow } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { normalizeRole } from "@/lib/permissions";
import { writeAudit } from "@/lib/sheets/audit";

type Ctx = { params: Promise<{ email: string }> };

function hashPasswordV21(email: string, plain: string): string {
  const salt =
    process.env.SECRET_SALT ||
    process.env.GOOGLE_AUTH_SALT ||
    process.env.SALT ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    "";
  const raw = `${String(email).toLowerCase().trim()}:${String(plain)}:${salt}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

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
 * Cập nhật Role, Quanly, HoatDong, TrangThai, Password.
 * Khóa user / đổi MK → session JWT cũ bị revoke (sv mismatch / status).
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

    // Đổi mật khẩu → revoke mọi JWT cũ (fingerprint Password đổi)
    const newPassword = body.password ?? body.matKhau ?? body.newPassword;
    if (newPassword !== undefined && String(newPassword).trim() !== "") {
      const plain = String(newPassword).trim();
      if (plain.length < 8) {
        return jsonResponse(
          error("VALIDATION_ERROR", "Mật khẩu tối thiểu 8 ký tự"),
          400
        );
      }
      patch.Password = hashPasswordV21(email, plain);
    }

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
      patch.Password !== undefined ||
      patch.TrangThai === "Locked" ||
      patch.HoatDong === false;

    await writeAudit({
      email: gate.user!.email,
      role: gate.user!.role,
      action: revoked ? "USER_REVOKE_SESSIONS" : "USER_UPDATE",
      targetId: email,
      newValue: {
        ...patch,
        Password: patch.Password ? "(hashed)" : undefined,
      },
      lyDo: revoked
        ? `Admin cập nhật user ${email} — revoke session (khóa/đổi MK)`
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
