import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { updateSheetRowByKey, appendSheetRow } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { normalizeRole } from "@/lib/permissions";

type Ctx = { params: Promise<{ email: string }> };

function requireAdmin(token: string | null) {
  const user = getCurrentUser(token);
  if (!user)
    return {
      error: jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401),
    };
  if (user.role !== "ADMIN" && !user.permissions.includes("*")) {
    return {
      error: jsonResponse(error("PERMISSION_DENIED", "Chỉ ADMIN"), 403),
    };
  }
  return { user };
}

/** PATCH /api/v1/users/:email — cập nhật Role, Quanly, HoatDong, TrangThai */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const gate = requireAdmin(token);
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
      success({ email, patch, row }, { message: "Đã cập nhật User" })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(
      error("SYSTEM_UNEXPECTED_ERROR", (e as Error).message || "Lỗi"),
      500
    );
  }
}
