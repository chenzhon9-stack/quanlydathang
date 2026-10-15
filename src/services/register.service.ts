/**
 * Đăng ký V21:
 * 1) requestRegisterOtp — validate + gửi OTP (chưa tạo User)
 * 2) verifyRegisterOtp — đúng OTP mới append User (Pending, chờ admin)
 *
 * Draft đăng ký lưu trong PasswordReset.GhiChu (JSON) vì Vercel không có CacheService.
 * Purpose OTP = "register"
 */
import { createHash, randomBytes, randomInt } from "crypto";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
  appendSheetRow,
  readSheetAsObjects,
  updateSheetRowByKey,
} from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { writeAudit } from "@/lib/sheets/audit";
import { passwordStrengthError } from "@/services/password.service";

const PURPOSE_REGISTER = "register";
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RL_MAX = 5;
const OTP_RL_WINDOW_MS = 15 * 60 * 1000;

const otpRateMemory = new Map<string, { count: number; resetAt: number }>();

type RegDraft = {
  hoTen: string;
  dienThoai: string;
  phongBan: string;
  passwordHash: string;
};

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

function isSafeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

function cleanPlain(v: string, max: number): string {
  return String(v || "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, max);
}

function getAuthSalt(): string {
  return (
    process.env.SECRET_SALT ||
    process.env.GOOGLE_AUTH_SALT ||
    process.env.SALT ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    ""
  );
}

function hashPasswordV21(email: string, plain: string): string {
  const e = String(email || "").toLowerCase().trim();
  const p = String(plain || "");
  const s = getAuthSalt();
  return createHash("sha256").update(`${e}:${p}:${s}`, "utf8").digest("hex");
}

function genOtp6(): string {
  return String(randomInt(100000, 999999));
}

function checkRateMemory(email: string): string | null {
  const key = `reg:${email.toLowerCase()}`;
  const now = Date.now();
  const cur = otpRateMemory.get(key);
  if (!cur || cur.resetAt < now) {
    otpRateMemory.set(key, { count: 1, resetAt: now + OTP_RL_WINDOW_MS });
    return null;
  }
  if (cur.count >= OTP_RL_MAX) {
    return "Bạn đã yêu cầu OTP quá nhiều lần. Vui lòng thử lại sau 15 phút.";
  }
  cur.count += 1;
  return null;
}

async function deliverRegisterOtp(
  email: string,
  otp: string
): Promise<{ ok: boolean; via: string; error?: string }> {
  try {
    const { isSmtpConfigured, sendOtpEmail } = await import("@/lib/mail");
    if (isSmtpConfigured()) {
      const r = await sendOtpEmail(email, otp, PURPOSE_REGISTER);
      if (r.ok) return { ok: true, via: "smtp" };
      console.warn("[register] SMTP fail:", r.error);
    }
  } catch (e) {
    console.warn("[register] SMTP module", e);
  }

  const gasUrl =
    process.env.GAS_SEND_ORDER_URL ||
    process.env.GAS_WEBAPP_URL ||
    process.env.GAS_WEBHOOK_URL ||
    "";
  const secret =
    process.env.WEBHOOK_SECRET || process.env.GAS_WEBHOOK_SECRET || "";
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
          purpose: PURPOSE_REGISTER,
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
        /* HTML */
      }
      if (json.success) return { ok: true, via: "gas" };
      console.warn("[register] GAS sendOtp:", json.error || text.slice(0, 100));
    } catch (e) {
      console.warn("[register] GAS fail", e);
    }
  }

  console.info(
    `[register] OTP for ${email}: ${otp} (TTL 15m) — cấu hình SMTP_* hoặc GAS sendOtp`
  );
  return { ok: true, via: "sheet_log" };
}

async function emailExists(email: string): Promise<boolean> {
  const rows = await readSheetAsObjects(SHEETS.USER);
  const e = email.toLowerCase();
  return rows.some((r) => pick(r, ["Email", "email"]).toLowerCase() === e);
}

/**
 * Bước 1 — V21 requestRegisterOtp: chưa tạo User, chỉ OTP + draft.
 */
export async function requestRegisterOtp(input: {
  email: string;
  password: string;
  confirmPassword: string;
  hoTen?: string;
  dienThoai?: string;
  phongBan?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSheetsConfigured()) {
    return { success: false, error: "Hệ thống chưa cấu hình dữ liệu." };
  }

  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const confirm = String(input.confirmPassword || "");
  const hoTen = cleanPlain(String(input.hoTen || ""), 80);
  const dienThoai = cleanPlain(String(input.dienThoai || ""), 20);
  const phongBan = cleanPlain(String(input.phongBan || ""), 60);

  if (!email || !isSafeEmail(email)) {
    return { success: false, error: "Email không hợp lệ." };
  }
  if (password !== confirm) {
    return { success: false, error: "Mật khẩu xác nhận không khớp." };
  }
  const strength = passwordStrengthError(password);
  if (strength) return { success: false, error: strength };
  if (!hoTen || hoTen.length < 2) {
    return { success: false, error: "Vui lòng nhập họ tên." };
  }

  if (await emailExists(email)) {
    return {
      success: false,
      error: "Email này đã tồn tại trong hệ thống.",
    };
  }

  const rl = checkRateMemory(email);
  if (rl) return { success: false, error: rl };

  const passwordHash = hashPasswordV21(email, password);
  const draft: RegDraft = { hoTen, dienThoai, phongBan, passwordHash };
  const otp = genOtp6();
  const token = "REG-" + randomBytes(12).toString("hex");
  const now = new Date();
  const exp = new Date(now.getTime() + OTP_TTL_MS);

  await appendSheetRow(SHEETS.RESET, {
    Token: token,
    Email: email,
    OTP: otp,
    Purpose: PURPOSE_REGISTER,
    CreatedAt: now.toISOString(),
    ExpiredAt: exp.toISOString(),
    Used: false,
    UsedAt: "",
    RequestIp: "",
    GhiChu: JSON.stringify(draft),
  });

  const mail = await deliverRegisterOtp(email, otp);
  if (!mail.ok) {
    return {
      success: false,
      error: mail.error || "Không gửi được email OTP.",
    };
  }

  try {
    await writeAudit({
      email,
      role: "guest",
      action: "REGISTER_OTP_REQUEST",
      targetId: email,
      lyDo: `Gửi OTP đăng ký via=${mail.via}`,
    });
  } catch {
    /* optional */
  }

  return {
    success: true,
    message: "Mã OTP đã được gửi đến email của bạn.",
  };
}

/**
 * Gửi lại OTP — giữ nguyên draft (hoTen/passwordHash) từ dòng register chưa dùng gần nhất.
 */
export async function resendRegisterOtp(emailRaw: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!isSheetsConfigured()) {
    return { success: false, error: "Hệ thống chưa cấu hình dữ liệu." };
  }
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email || !isSafeEmail(email)) {
    return { success: false, error: "Email không hợp lệ." };
  }
  if (await emailExists(email)) {
    return { success: false, error: "Email này đã tồn tại trong hệ thống." };
  }

  const rl = checkRateMemory(email);
  if (rl) return { success: false, error: rl };

  const rows = await readSheetAsObjects(SHEETS.RESET);
  const candidates = rows
    .filter((r) => {
      if (pick(r, ["Email"]).toLowerCase() !== email) return false;
      if (pick(r, ["Purpose"]) !== PURPOSE_REGISTER) return false;
      if (isTruthy(r.Used)) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = Date.parse(pick(a, ["CreatedAt"])) || 0;
      const tb = Date.parse(pick(b, ["CreatedAt"])) || 0;
      return tb - ta;
    });

  if (!candidates.length) {
    return {
      success: false,
      error: "Phiên đăng ký đã hết hạn. Vui lòng thử lại từ đầu.",
    };
  }

  const prev = candidates[0];
  let draft: RegDraft | null = null;
  try {
    draft = JSON.parse(pick(prev, ["GhiChu"])) as RegDraft;
  } catch {
    draft = null;
  }
  if (!draft?.passwordHash) {
    return {
      success: false,
      error: "Phiên đăng ký đã hết hạn. Vui lòng thử lại từ đầu.",
    };
  }

  // Đánh dấu OTP cũ đã dùng (tránh nhập mã cũ)
  const oldToken = pick(prev, ["Token"]);
  if (oldToken) {
    try {
      await updateSheetRowByKey(SHEETS.RESET, "Token", oldToken, {
        Used: true,
        UsedAt: new Date().toISOString(),
        GhiChu: pick(prev, ["GhiChu"]),
      });
    } catch {
      /* continue */
    }
  }

  const otp = genOtp6();
  const token = "REG-" + randomBytes(12).toString("hex");
  const now = new Date();
  const exp = new Date(now.getTime() + OTP_TTL_MS);
  await appendSheetRow(SHEETS.RESET, {
    Token: token,
    Email: email,
    OTP: otp,
    Purpose: PURPOSE_REGISTER,
    CreatedAt: now.toISOString(),
    ExpiredAt: exp.toISOString(),
    Used: false,
    UsedAt: "",
    RequestIp: "",
    GhiChu: JSON.stringify(draft),
  });

  const mail = await deliverRegisterOtp(email, otp);
  if (!mail.ok) {
    return {
      success: false,
      error: mail.error || "Không gửi được email OTP.",
    };
  }
  return { success: true, message: "Đã gửi lại mã OTP." };
}

/**
 * Bước 2 — V21 verifyRegisterOtp: OTP đúng → tạo User Pending.
 */
export async function verifyRegisterOtp(input: {
  email: string;
  otp: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isSheetsConfigured()) {
    return { success: false, error: "Hệ thống chưa cấu hình dữ liệu." };
  }
  const email = String(input.email || "").trim().toLowerCase();
  const otp = String(input.otp || "").trim();
  if (!email || !otp) {
    return { success: false, error: "Thiếu email hoặc mã OTP." };
  }

  if (await emailExists(email)) {
    return { success: false, error: "Email đã tồn tại." };
  }

  const rows = await readSheetAsObjects(SHEETS.RESET);
  const candidates = rows
    .filter((r) => {
      if (pick(r, ["Email"]).toLowerCase() !== email) return false;
      if (pick(r, ["Purpose"]) !== PURPOSE_REGISTER) return false;
      if (pick(r, ["OTP", "Otp"]) !== otp) return false;
      if (isTruthy(r.Used)) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = Date.parse(pick(a, ["CreatedAt"])) || 0;
      const tb = Date.parse(pick(b, ["CreatedAt"])) || 0;
      return tb - ta;
    });

  if (!candidates.length) {
    return {
      success: false,
      error: "OTP không hợp lệ hoặc đã được sử dụng.",
    };
  }
  const record = candidates[0];
  const expMs = Date.parse(pick(record, ["ExpiredAt"]));
  if (expMs && expMs < Date.now()) {
    return {
      success: false,
      error: "OTP đã hết hạn. Vui lòng gửi lại mã hoặc đăng ký lại.",
    };
  }

  let draft: RegDraft | null = null;
  try {
    draft = JSON.parse(pick(record, ["GhiChu"])) as RegDraft;
  } catch {
    draft = null;
  }
  if (!draft?.passwordHash) {
    return {
      success: false,
      error: "Phiên đăng ký đã hết hạn. Vui lòng thử lại từ đầu.",
    };
  }

  const token = pick(record, ["Token"]);
  if (token) {
    await updateSheetRowByKey(SHEETS.RESET, "Token", token, {
      Used: true,
      UsedAt: new Date().toISOString(),
    });
  }

  // First user → admin Active (parity V21)
  const allUsers = await readSheetAsObjects(SHEETS.USER);
  const isFirstUser = allUsers.length === 0;
  const nowIso = new Date().toISOString();

  await appendSheetRow(SHEETS.USER, {
    Email: email,
    Quanly: isFirstUser ? "all" : "",
    Password: draft.passwordHash,
    Role: isFirstUser ? "ADMIN" : "VIEWER",
    HoatDong: isFirstUser ? true : false,
    TrangThai: isFirstUser ? "Approved" : "Pending",
    HoTen: draft.hoTen || email,
    PhongBan: draft.phongBan || "",
    DienThoai: draft.dienThoai || "",
    ZaloUserId: "",
    CreatedAt: nowIso,
    ApprovedAt: isFirstUser ? nowIso : "",
    ApprovedBy: isFirstUser ? email : "",
    LastLogin: "",
    GhiChu: "self_register_otp",
  });

  try {
    await writeAudit({
      email,
      role: isFirstUser ? "ADMIN" : "VIEWER",
      action: "USER_REGISTER",
      targetId: email,
      newValue: {
        hoTen: draft.hoTen,
        trangThai: isFirstUser ? "Approved" : "Pending",
      },
      lyDo: isFirstUser
        ? "Tài khoản admin đầu tiên tự đăng ký (OTP)"
        : "Người dùng tự đăng ký sau OTP — chờ admin duyệt",
    });
  } catch {
    /* optional */
  }

  return {
    success: true,
    message: isFirstUser
      ? "Đăng ký thành công. Bạn là tài khoản đầu tiên (Admin) — có thể đăng nhập ngay."
      : "Đăng ký thành công. Tài khoản đang chờ admin duyệt. Bạn sẽ đăng nhập được sau khi được phê duyệt.",
  };
}

/** @deprecated — dùng requestRegisterOtp + verifyRegisterOtp */
export async function registerUser(input: {
  email: string;
  password: string;
  confirmPassword: string;
  hoTen?: string;
  dienThoai?: string;
  phongBan?: string;
}): Promise<{ success: boolean; message?: string; error?: string }> {
  return requestRegisterOtp(input);
}
