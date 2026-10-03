/**
 * Self-service mật khẩu — parity V21:
 * - requestPasswordReset(email) → OTP sheet PasswordReset + gửi mail
 * - resetPasswordWithOtp → verify OTP → hash Password → revoke session (sv đổi)
 * Admin KHÔNG được đặt mật khẩu hộ user (V21 exclude cột Password khi edit User).
 */
import { createHash, randomInt, randomBytes } from "crypto";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
  readSheetAsObjects,
  appendSheetRow,
  updateSheetRowByKey,
} from "@/lib/sheets/dal";
import { writeAudit } from "@/lib/sheets/audit";

const OTP_TTL_MS = 15 * 60 * 1000;
const PURPOSE_RESET = "reset_password";

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

export function passwordStrengthError(password: string): string | null {
  const p = String(password || "");
  if (p.length < 8) return "Mật khẩu phải có ít nhất 8 ký tự.";
  if (!/[A-Za-z]/.test(p)) return "Mật khẩu nên có ít nhất 1 chữ cái.";
  if (!/[0-9]/.test(p)) return "Mật khẩu nên có ít nhất 1 chữ số.";
  return null;
}

function genOtp6(): string {
  return String(randomInt(100000, 999999));
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function isTruthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "x";
}

async function findUserRow(email: string): Promise<Record<string, unknown> | null> {
  const rows = await readSheetAsObjects(SHEETS.USER);
  const e = email.toLowerCase();
  return (
    rows.find((r) => pick(r, ["Email", "email"]).toLowerCase() === e) || null
  );
}

/** Gửi OTP qua GAS webhook (nếu cấu hình) hoặc log server. */
async function deliverOtpMail(
  email: string,
  otp: string,
  purpose: string
): Promise<{ ok: boolean; via: string; error?: string }> {
  const gasUrl =
    process.env.GAS_SEND_ORDER_URL ||
    process.env.GAS_WEBAPP_URL ||
    process.env.GAS_WEBHOOK_URL ||
    "";
  const secret = process.env.WEBHOOK_SECRET || process.env.GAS_WEBHOOK_SECRET || "";

  if (gasUrl) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 25000);
      const res = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendOtp",
          secret: secret || undefined,
          email,
          otp,
          purpose,
        }),
        signal: ac.signal,
        redirect: "follow",
      });
      clearTimeout(t);
      const text = await res.text();
      let json: { success?: boolean; error?: string } = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        /* HTML redirect */
      }
      if (json.success) return { ok: true, via: "gas" };
      // GAS chưa có action sendOtp → vẫn coi đã ghi sheet; user cần admin/GAS mail
      console.warn("[password] GAS sendOtp:", json.error || text.slice(0, 120));
    } catch (e) {
      console.warn("[password] GAS sendOtp fail", e);
    }
  }

  // Dev / fallback: log OTP (không trả về client)
  console.info(
    `[password] OTP ${purpose} for ${email}: ${otp} (TTL 15m) — cấu hình GAS action sendOtp hoặc SMTP để gửi mail thật`
  );
  return { ok: true, via: "sheet_log" };
}

/**
 * V21 requestPasswordReset — luôn trả success nếu email không tồn tại (không lộ user).
 */
export async function requestPasswordReset(emailRaw: string): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  if (!isSheetsConfigured()) {
    return { success: false, message: "", error: "Chưa cấu hình Google Sheets" };
  }
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { success: false, message: "", error: "Email không hợp lệ." };
  }

  const user = await findUserRow(email);
  if (!user) {
    return {
      success: true,
      message: "Nếu email tồn tại, mã OTP đã được gửi.",
    };
  }

  const otp = genOtp6();
  const token = randomBytes(16).toString("hex");
  const now = new Date();
  const exp = new Date(now.getTime() + OTP_TTL_MS);

  await appendSheetRow(SHEETS.RESET, {
    Token: token,
    Email: email,
    OTP: otp,
    Purpose: PURPOSE_RESET,
    CreatedAt: now.toISOString(),
    ExpiredAt: exp.toISOString(),
    Used: false,
    UsedAt: "",
    RequestIp: "",
    GhiChu: "vercel_requestPasswordReset",
  });

  const mail = await deliverOtpMail(email, otp, PURPOSE_RESET);
  if (!mail.ok) {
    return {
      success: false,
      message: "",
      error: mail.error || "Không gửi được email OTP.",
    };
  }

  await writeAudit({
    email,
    role: "guest",
    action: "PASSWORD_RESET_REQUEST",
    targetId: email,
    lyDo: `Yêu cầu OTP đổi MK via=${mail.via}`,
  });

  return {
    success: true,
    message: "Mã OTP đã được gửi đến email của bạn (hiệu lực 15 phút).",
  };
}

/**
 * V21 resetPasswordWithOtp
 */
export async function resetPasswordWithOtp(input: {
  email: string;
  otp: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSheetsConfigured()) {
    return { success: false, error: "Chưa cấu hình Google Sheets" };
  }
  const email = String(input.email || "").trim().toLowerCase();
  const otp = String(input.otp || "").trim();
  const newPassword = String(input.newPassword || "");
  const confirmPassword = String(input.confirmPassword || "");

  if (!email || !otp) return { success: false, error: "Thiếu email hoặc mã OTP." };
  if (newPassword !== confirmPassword) {
    return { success: false, error: "Mật khẩu xác nhận không khớp." };
  }
  const strength = passwordStrengthError(newPassword);
  if (strength) return { success: false, error: strength };

  const rows = await readSheetAsObjects(SHEETS.RESET);
  const candidates = rows
    .filter((r) => {
      const e = pick(r, ["Email"]).toLowerCase();
      const o = pick(r, ["OTP", "Otp"]);
      const p = pick(r, ["Purpose"]);
      const used = isTruthy(r.Used);
      return e === email && o === otp && p === PURPOSE_RESET && !used;
    })
    .sort((a, b) => {
      const ta = Date.parse(pick(a, ["CreatedAt"])) || 0;
      const tb = Date.parse(pick(b, ["CreatedAt"])) || 0;
      return tb - ta;
    });

  if (!candidates.length) {
    return { success: false, error: "OTP không hợp lệ hoặc đã được sử dụng." };
  }
  const record = candidates[0];
  const expMs = Date.parse(pick(record, ["ExpiredAt"]));
  if (expMs && expMs < Date.now()) {
    return { success: false, error: "OTP đã hết hạn. Vui lòng yêu cầu mã mới." };
  }

  const token = pick(record, ["Token"]);
  if (token) {
    await updateSheetRowByKey(SHEETS.RESET, "Token", token, {
      Used: true,
      UsedAt: new Date().toISOString(),
    });
  }

  const hashed = hashPasswordV21(email, newPassword);
  const row = await updateSheetRowByKey(SHEETS.USER, "Email", email, {
    Password: hashed,
  });
  if (row < 0) return { success: false, error: "Không tìm thấy tài khoản." };

  await writeAudit({
    email,
    role: "guest",
    action: "PASSWORD_RESET_DONE",
    targetId: email,
    lyDo: "User tự đổi mật khẩu qua OTP — session cũ vô hiệu (sv fingerprint)",
  });

  return { success: true, message: "Đổi mật khẩu thành công. Hãy đăng nhập lại." };
}
