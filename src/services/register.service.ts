/**
 * Đăng ký tài khoản tự phục vụ + chờ Admin duyệt (parity V21).
 * - Tạo User: TrangThai=Pending, HoatDong=false, Role=VIEWER
 * - Không cấp token / không đăng nhập được đến khi Approved
 */
import { createHash } from "crypto";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { appendSheetRow, readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { writeAudit } from "@/lib/sheets/audit";
import { passwordStrengthError } from "@/services/password.service";

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
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

function isSafeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

export type RegisterInput = {
  email: string;
  password: string;
  confirmPassword: string;
  hoTen?: string;
  dienThoai?: string;
  phongBan?: string;
};

/**
 * Self-register → Pending. Admin duyệt trên tab Users.
 */
export async function registerUser(input: RegisterInput): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  if (!isSheetsConfigured()) {
    return { success: false, error: "Hệ thống chưa cấu hình dữ liệu." };
  }

  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const confirm = String(input.confirmPassword || "");
  const hoTen = String(input.hoTen || "").trim();
  const dienThoai = String(input.dienThoai || "").trim();
  const phongBan = String(input.phongBan || "").trim();

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

  const rows = await readSheetAsObjects(SHEETS.USER);
  const existed = rows.find(
    (r) => pick(r, ["Email", "email"]).toLowerCase() === email
  );
  if (existed) {
    const tt = pick(existed, ["TrangThai", "Status"]);
    if (tt === "Pending") {
      return {
        success: false,
        error: "Email này đã đăng ký và đang chờ admin duyệt.",
      };
    }
    return {
      success: false,
      error: "Email đã có tài khoản. Hãy đăng nhập hoặc dùng Quên mật khẩu.",
    };
  }

  const nowIso = new Date().toISOString();
  const hashed = hashPasswordV21(email, password);

  await appendSheetRow(SHEETS.USER, {
    Email: email,
    Quanly: "",
    Password: hashed,
    Role: "VIEWER",
    HoatDong: false,
    TrangThai: "Pending",
    HoTen: hoTen,
    PhongBan: phongBan,
    DienThoai: dienThoai,
    ZaloUserId: "",
    CreatedAt: nowIso,
    ApprovedAt: "",
    ApprovedBy: "",
    LastLogin: "",
    GhiChu: "self_register",
  });

  try {
    await writeAudit({
      email,
      role: "VIEWER",
      action: "USER_REGISTER",
      targetId: email,
      newValue: { hoTen, phongBan, trangThai: "Pending" },
      lyDo: "Đăng ký tài khoản mới — chờ admin duyệt",
    });
  } catch {
    /* audit optional */
  }

  return {
    success: true,
    message:
      "Đăng ký thành công. Tài khoản đang chờ admin duyệt. Bạn sẽ đăng nhập được sau khi được phê duyệt.",
  };
}
