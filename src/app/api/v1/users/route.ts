import { NextRequest } from "next/server";
import { getCurrentUser, listUsersFromSheet } from "@/lib/auth";
import { MOCK_USERS } from "@/mocks/data";
import { success, error, jsonResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    if (user.role !== "ADMIN" && !user.permissions.includes("*")) {
      return jsonResponse(error("PERMISSION_DENIED", "Chỉ ADMIN"), 403);
    }

    const fromSheet = await listUsersFromSheet();
    if (fromSheet.length > 0) {
      return jsonResponse(
        success({
          items: fromSheet,
          source: "sheet",
        })
      );
    }

    // fallback mock list
    const items = Object.values(MOCK_USERS).map((r) => ({
      email: r.user.email,
      hoTen: r.user.hoTen,
      role: r.user.role,
      quanly: r.user.quanly,
      active: true,
    }));
    return jsonResponse(success({ items, source: "mock" }));
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi"), 500);
  }
}
