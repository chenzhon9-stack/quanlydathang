import { NextRequest } from "next/server";
import { requireAdminVerified } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { gasWebhookUrl, gasWebhookSecret } from "@/lib/gas-webhook";

/**
 * Mask URL / secret for admin debug — never return full secret.
 */
function maskUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "(empty)";
  try {
    const parsed = new URL(u);
    const path = parsed.pathname || "";
    const tail = path.length > 12 ? path.slice(-12) : path;
    return `${parsed.origin}/…${tail}`;
  } catch {
    if (u.length <= 16) return u.slice(0, 4) + "…";
    return u.slice(0, 24) + "…" + u.slice(-8);
  }
}

function maskSecret(s: string): string {
  const t = (s || "").trim();
  if (!t) return "(empty)";
  if (t.length <= 4) return "****";
  return t.slice(0, 2) + "****" + t.slice(-2);
}

function maskEmail(s: string): string {
  const t = (s || "").trim();
  if (!t) return "(empty)";
  const at = t.indexOf("@");
  if (at < 1) return t.slice(0, 2) + "****";
  return t.slice(0, 2) + "****" + t.slice(at);
}

/**
 * GET /api/v1/debug/send-env
 * Admin-only: kiểm tra env phục vụ gửi đơn (GAS webhook, SMTP) — giá trị đã mask.
 */
export async function GET(req: NextRequest) {
  try {
    const gate = await requireAdminVerified(req);
    if (gate.error) {
      return jsonResponse(
        error(gate.error.code, gate.error.message),
        gate.error.status
      );
    }

    const gasUrl = gasWebhookUrl();
    const secret = gasWebhookSecret();
    const smtpUser =
      process.env.SMTP_USER ||
      process.env.GMAIL_USER ||
      process.env.MAIL_USER ||
      "";
    const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST || "";
    const smtpPassSet = !!(
      process.env.SMTP_PASS ||
      process.env.SMTP_PASSWORD ||
      process.env.GMAIL_APP_PASSWORD ||
      process.env.MAIL_PASS
    );

    return jsonResponse(
      success({
        GAS_SEND_ORDER_URL: maskUrl(gasUrl),
        GAS_SEND_ORDER_URL_set: !!gasUrl,
        WEBHOOK_SECRET: maskSecret(secret),
        WEBHOOK_SECRET_set: !!secret,
        SMTP_USER: maskEmail(smtpUser),
        SMTP_USER_set: !!smtpUser,
        SMTP_HOST: smtpHost || "(default/empty)",
        SMTP_PASS_set: smtpPassSet,
        note:
          "Giá trị đã mask. sendOrder dùng GAS khi GAS_SEND_ORDER_URL có; OTP ưu tiên SMTP nếu cấu hình.",
      })
    );
  } catch (e) {
    console.error("[debug/send-env]", e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
