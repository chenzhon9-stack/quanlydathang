import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") || null;
  const user = getCurrentUser(token);

  if (!user) {
    return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
  }

  return jsonResponse(success({ user, permissions: user.permissions }));
}
