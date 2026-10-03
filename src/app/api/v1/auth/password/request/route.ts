import { NextRequest } from "next/server";
import { success, error, jsonResponse } from "@/lib/api";
import { requestPasswordReset } from "@/services/password.service";

/** POST { email } — V21 requestPasswordReset */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim();
    const r = await requestPasswordReset(email);
    if (!r.success) {
      return jsonResponse(error("VALIDATION_ERROR", r.error || "Lỗi"), 400);
    }
    return jsonResponse(success({ message: r.message }, { message: r.message }));
  } catch (e) {
    console.error("[auth/password/request]", e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
