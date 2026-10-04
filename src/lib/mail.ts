/**
 * Gửi mail từ Vercel — Gmail SMTP (App Password) qua nodemailer.
 *
 * Env (Vercel Project → Settings → Environment Variables):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=your@gmail.com
 *   SMTP_PASS=<App Password 16 ký tự>
 *   SMTP_FROM="Viết Hải <your@gmail.com>"   // optional
 *
 * Tạo App Password: Google Account → Security → 2-Step Verification → App passwords
 * (Bắt buộc bật xác minh 2 bước).
 *
 * Lưu ý Gmail: ~100–500 mail/ngày (free). Không dùng mật khẩu đăng nhập thường.
 */
import type { Transporter } from "nodemailer";

export type SendMailInput = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
  }>;
};

export type SendMailResult =
  | { ok: true; messageId?: string; via: "smtp" }
  | { ok: false; error: string; via?: "smtp" };

function env(name: string, fallback = ""): string {
  return String(process.env[name] ?? fallback).trim();
}

/** Đã cấu hình đủ SMTP chưa */
export function isSmtpConfigured(): boolean {
  return !!(env("SMTP_USER") && env("SMTP_PASS"));
}

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter;
  // dynamic import — tránh crash nếu chưa npm i nodemailer
  const nodemailer = await import("nodemailer");
  const host = env("SMTP_HOST", "smtp.gmail.com");
  const port = Number(env("SMTP_PORT", "465")) || 465;
  const secure =
    env("SMTP_SECURE", port === 465 ? "true" : "false").toLowerCase() !==
    "false";

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: env("SMTP_USER"),
      pass: env("SMTP_PASS").replace(/\s+/g, ""), // App Password có thể có khoảng trắng
    },
    // Vercel serverless: tránh giữ connection quá lâu
    pool: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return _transporter;
}

/**
 * Gửi 1 email qua SMTP (Gmail App Password).
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!isSmtpConfigured()) {
    return {
      ok: false,
      error:
        "Chưa cấu hình SMTP_USER / SMTP_PASS trên Vercel (Gmail App Password).",
    };
  }
  const to = input.to;
  if (!to || (Array.isArray(to) && !to.length)) {
    return { ok: false, error: "Thiếu người nhận (to)." };
  }
  if (!input.subject) {
    return { ok: false, error: "Thiếu subject." };
  }
  if (!input.text && !input.html) {
    return { ok: false, error: "Thiếu nội dung text/html." };
  }

  const from =
    env("SMTP_FROM") ||
    `Viết Hải <${env("SMTP_USER")}>`;

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      bcc: input.bcc,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
    return {
      ok: true,
      messageId: info.messageId,
      via: "smtp",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mail] SMTP send failed:", msg);
    return { ok: false, error: msg, via: "smtp" };
  }
}

/** Template OTP quên/đổi mật khẩu */
export async function sendOtpEmail(
  email: string,
  otp: string,
  purpose = "reset_password"
): Promise<SendMailResult> {
  const title =
    purpose === "change_password"
      ? "Mã OTP đổi mật khẩu"
      : "Mã OTP đặt lại mật khẩu";
  const html = `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
    <p>Xin chào,</p>
    <p>Mã OTP <strong>${title}</strong> của bạn là:</p>
    <p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#1d4ed8">${otp}</p>
    <p>Mã có hiệu lực <strong>15 phút</strong>. Không chia sẻ mã này cho người khác.</p>
    <p style="color:#64748b;font-size:12px">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0"/>
    <p style="color:#94a3b8;font-size:12px">Viết Hải — Quản lý vận tải</p>
  </div>`;
  return sendMail({
    to: email,
    subject: `[Viết Hải] ${title}: ${otp}`,
    text: `${title}: ${otp}\nHiệu lực 15 phút. Không chia sẻ mã này.`,
    html,
  });
}
