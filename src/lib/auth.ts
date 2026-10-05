import { createHash } from "crypto";
import { MOCK_USERS } from "@/mocks/data";
import type { UserContext, AccessScope, Role } from "@/types";
import { normalizeRole, permissionsForRole, resolvePermissionsFromSheets } from "@/lib/permissions";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

/**
 * Stateless session token — bắt buộc trên Vercel serverless.
 * Token = vh1.<base64url JSON { user, exp }>
 *
 * Login: ưu tiên sheet User → fallback mock.
 * Password: plain text (V21 legacy) hoặc SHA-256 / MD5 hex.
 */

/** TTL JWT — export để login/route và chỗ khác dùng chung (tránh hardcode lệch). */
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/** Cache dòng User theo email — giảm spam Sheets khi /me / admin verify. */
const USER_ROW_TTL_MS = 30_000;
const userRowCache = new Map<
  string,
  { row: Record<string, string>; sheet: string; exp: number }
>();

/** Xóa cache user (sau đổi MK / khóa / admin update). */
export function invalidateUserRowCache(email?: string): void {
  if (!email) {
    userRowCache.clear();
    return;
  }
  userRowCache.delete(String(email).toLowerCase().trim());
}

function b64urlEncode(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode<T>(s: string): T | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

type TokenPayload = {
  user: UserContext;
  exp: number;
  /** Session version — fingerprint mật khẩu lúc login; đổi MK / khóa → token cũ invalid */
  sv?: string;
};

/** Fingerprint ổn định từ ô Password (không lưu plain). */
function passwordFingerprint(sheetPass: string): string {
  const s = String(sheetPass || "").trim();
  if (!s) return "0";
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "")
      return String(row[k]).trim();
    const found = Object.keys(row).find(
      (h) => h.toLowerCase().replace(/\s/g, "") === k.toLowerCase().replace(/\s/g, "")
    );
    if (found && row[found] != null && String(row[found]).trim() !== "")
      return String(row[found]).trim();
  }
  return "";
}

/** V21 verifyUserManual — TrangThai + HoatDong */
function checkUserStatus(row: Record<string, string>): { ok: boolean; reason?: string } {
  const trangThai = pick(row, ["TrangThai", "Status", "Trạng thái"]) || "Approved";
  const tt = trangThai.trim();
  if (tt === "Pending")
    return { ok: false, reason: "Tài khoản đang chờ admin duyệt." };
  if (tt === "Rejected")
    return { ok: false, reason: "Tài khoản đã bị từ chối." };
  if (tt === "Locked" || tt.toLowerCase() === "locked")
    return { ok: false, reason: "Tài khoản đang bị khóa." };

  const active = pick(row, ["HoatDong", "Active", "IsActive", "Hoạt động"]).toLowerCase();
  if (["false", "0", "no", "không", "khoa", "khóa"].includes(active)) {
    return { ok: false, reason: "Tài khoản chưa kích hoạt hoặc đã bị khóa." };
  }
  return { ok: true };
}

function isActiveUser(row: Record<string, string>): boolean {
  return checkUserStatus(row).ok;
}

/**
 * V21 _hashPassword_(email, plain):
 * SHA-256( email_lower + ":" + plain + ":" + salt )
 * salt = SECRET_SALT | SALT | SPREADSHEET_ID (Script Properties)
 */
function getAuthSalt(): string {
  return (
    process.env.SECRET_SALT ||
    process.env.GOOGLE_AUTH_SALT ||
    process.env.SALT ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    ""
  );
}

/** Giống Utilities.computeDigest SHA_256 → hex lowercase từng byte */
function hashPasswordV21(email: string, plain: string, salt?: string): string {
  const e = String(email || "").toLowerCase().trim();
  const p = String(plain || "");
  const s = salt ?? getAuthSalt();
  const raw = `${e}:${p}:${s}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function passwordMatches(
  sheetPass: string,
  email: string,
  input: string
): boolean {
  if (!sheetPass) return false;
  const stored = sheetPass.trim();
  const plain = String(input);

  // 1) V21 canonical hash
  const hashed = hashPasswordV21(email, plain);
  if (stored === hashed || stored.toLowerCase() === hashed) return true;

  // 2) Thử salt = spreadsheet id tường minh (nếu env khác)
  const ssid = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
  if (ssid && getAuthSalt() !== ssid) {
    const h2 = hashPasswordV21(email, plain, ssid);
    if (stored === h2 || stored.toLowerCase() === h2) return true;
  }

  // 3) Legacy plain (chỉ khi sheet chưa migrate hash)
  if (stored === plain || stored === plain.trim()) return true;

  return false;
}

function userFromSheetRow(row: Record<string, string>): UserContext | null {
  const email = pick(row, ["Email", "email", "E-mail"]).toLowerCase();
  if (!email || !email.includes("@")) return null;
  const role = normalizeRole(pick(row, ["Role", "VaiTro", "Vai trò", "role"]));
  return {
    email,
    role,
    quanly: pick(row, ["Quanly", "QuanLy", "Quản lý", "quanly"]) || "",
    hoTen:
      pick(row, ["HoTen", "Ho_Ten", "Name", "Ten", "Họ tên", "Ho Va Ten"]) ||
      email,
    permissions: permissionsForRole(role),
  };
}

async function findUserRow(
  emailLc: string
): Promise<{ row: Record<string, string>; sheet: string } | null> {
  const key = emailLc.toLowerCase().trim();
  const hit = userRowCache.get(key);
  if (hit && hit.exp > Date.now()) {
    return { row: hit.row, sheet: hit.sheet };
  }

  // Chuẩn V21: chỉ sheet User (SHEETS.USER). Legacy tên chỉ fallback nếu tab chuẩn lỗi.
  const candidates = [SHEETS.USER, "Users", "USER", "TaiKhoan"];
  for (const name of candidates) {
    try {
      const rows = await readSheetAsObjects(name, {});
      if (!rows.length) continue;
      const row = rows.find(
        (r) => pick(r, ["Email", "email", "E-mail"]).toLowerCase() === key
      );
      if (row) {
        userRowCache.set(key, {
          row,
          sheet: name,
          exp: Date.now() + USER_ROW_TTL_MS,
        });
        return { row, sheet: name };
      }
      // Tab User chuẩn đã đọc được nhưng không có email → không thử tên legacy
      if (name === SHEETS.USER) break;
    } catch (e) {
      console.info(`[Auth] skip sheet ${name}:`, (e as Error)?.message || e);
    }
  }
  return null;
}

async function loginFromSheet(
  email: string,
  password: string
): Promise<{ user: UserContext | null; reason?: string }> {
  if (!isSheetsConfigured()) {
    return { user: null, reason: "SHEETS_NOT_CONFIGURED" };
  }
  try {
    const found = await findUserRow(email.toLowerCase());
    if (!found) {
      console.info("[Auth] email not on User sheet:", email);
      return { user: null, reason: "USER_NOT_FOUND_ON_SHEET" };
    }
    const { row, sheet } = found;
    const status = checkUserStatus(row);
    if (!status.ok) {
      console.info("[Auth] user blocked", email, status.reason, "sheet=", sheet);
      return { user: null, reason: "USER_INACTIVE" };
    }
    const sheetPass = pick(row, [
      "Password",
      "MatKhau",
      "Mật khẩu",
      "password",
      "Pass",
      "MK",
    ]);
    if (!sheetPass) {
      console.info("[Auth] empty password cell", email);
      return { user: null, reason: "PASSWORD_EMPTY_ON_SHEET" };
    }
    if (!passwordMatches(sheetPass, email, password)) {
      console.info(
        "[Auth] password mismatch",
        email,
        "sheetPassLen=",
        sheetPass.length,
        "v21hashPrefix=",
        hashPasswordV21(email, password).slice(0, 8),
        "saltLen=",
        getAuthSalt().length
      );
      return { user: null, reason: "PASSWORD_MISMATCH" };
    }
    const user = userFromSheetRow(row);
    if (user) {
      const rbac = await resolvePermissionsFromSheets(user.email, user.role);
      user.role = rbac.role;
      user.permissions = rbac.permissions;
      console.info(
        "[Auth] Sheet login OK",
        user.email,
        user.role,
        "from",
        sheet,
        "rbac=",
        rbac.source,
        "perms=",
        user.permissions.length
      );
    }
    return { user };
  } catch (e) {
    console.error("[Auth] User sheet read failed", e);
    return { user: null, reason: "SHEET_READ_ERROR" };
  }
}

function loginFromMock(
  email: string,
  password: string
): UserContext | null {
  const record = MOCK_USERS[email.toLowerCase()];
  if (!record || record.password !== password) return null;
  const role = record.user.role;
  return {
    ...record.user,
    permissions: role === "ADMIN" ? ["*"] : permissionsForRole(role as Role),
  };
}

export type LoginFailReason =
  | "SHEETS_NOT_CONFIGURED"
  | "USER_NOT_FOUND_ON_SHEET"
  | "USER_INACTIVE"
  | "PASSWORD_EMPTY_ON_SHEET"
  | "PASSWORD_MISMATCH"
  | "SHEET_READ_ERROR"
  | "MOCK_MISS";

export async function login(
  email: string,
  password: string
): Promise<{ user: UserContext; token: string } | null> {
  const emailLc = String(email).toLowerCase().trim();
  const pass = String(password);

  // 1) Sheet User
  const sheetResult = await loginFromSheet(emailLc, pass);
  let user = sheetResult.user;
  let sv = "mock";

  // 2) Fallback mock (dev accounts)
  if (!user) {
    user = loginFromMock(emailLc, pass);
    if (user) {
      console.info("[Auth] Mock login OK", user.email);
      sv = "mock";
    } else {
      console.info(
        "[Auth] Login failed",
        emailLc,
        "sheetReason=",
        sheetResult.reason || "none"
      );
    }
  } else {
    // Lấy fingerprint từ sheet để revoke khi đổi MK
    try {
      const found = await findUserRow(emailLc);
      if (found) {
        const sheetPass = pick(found.row, [
          "Password",
          "MatKhau",
          "Mật khẩu",
          "password",
          "Pass",
          "MK",
        ]);
        sv = passwordFingerprint(sheetPass);
      }
    } catch {
      sv = "0";
    }
  }
  if (!user) return null;

  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: TokenPayload = { user, exp, sv };
  const token = `vh1.${b64urlEncode(payload)}`;
  return { user, token };
}

export function logout(_token: string) {
  // Stateless — client xóa token; revoke thật qua sv/status trên Sheet
}

/**
 * Parse token đồng bộ (không đọc Sheet).
 * Dùng cho đọc nhẹ; write nhạy cảm nên dùng getCurrentUserVerified.
 */
export function getCurrentUser(token: string | null): UserContext | null {
  if (!token) return null;
  if (!token.startsWith("vh1.")) return null;

  const raw = token.slice(4);
  const payload = b64urlDecode<TokenPayload>(raw);
  if (!payload?.user?.email || !payload.exp) return null;
  if (payload.exp < Date.now()) return null;

  // Không mutate payload decode — clone user
  const user: UserContext = { ...payload.user };
  const role = user.role;
  if (String(role).toUpperCase() === "ADMIN") {
    user.permissions = ["*"];
  } else if (!user.permissions?.length) {
    user.permissions = permissionsForRole(role);
  }
  return user;
}

/**
 * V21.06 Session Manager (tinh thần):
 * - User Locked / HoatDong=false → token vô hiệu
 * - Đổi mật khẩu (Password cell đổi) → sv mismatch → vô hiệu
 * Mock token (sv=mock) bỏ qua check Sheet.
 */
export async function getCurrentUserVerified(
  token: string | null
): Promise<UserContext | null> {
  if (!token || !token.startsWith("vh1.")) return null;
  const raw = token.slice(4);
  const payload = b64urlDecode<TokenPayload>(raw);
  if (!payload?.user?.email || !payload.exp) return null;
  if (payload.exp < Date.now()) return null;

  const base = getCurrentUser(token);
  if (!base) return null;

  // Mock / dev
  if (payload.sv === "mock" || !isSheetsConfigured()) return base;

  try {
    const found = await findUserRow(base.email.toLowerCase());
    if (!found) return null;
    const status = checkUserStatus(found.row);
    if (!status.ok) {
      console.info(
        "[Auth] session revoked (status)",
        base.email,
        status.reason
      );
      return null;
    }
    const sheetPass = pick(found.row, [
      "Password",
      "MatKhau",
      "Mật khẩu",
      "password",
      "Pass",
      "MK",
    ]);
    const nowSv = passwordFingerprint(sheetPass);
    // Token cũ không có sv → cho qua 1 lần (tương thích), khuyến nghị login lại sau
    if (payload.sv && payload.sv !== "0" && payload.sv !== nowSv) {
      console.info("[Auth] session revoked (password changed)", base.email);
      return null;
    }
    return base;
  } catch (e) {
    // Sheets lỗi: dùng cache stale ≤60s nếu có; không thì cho qua JWT (nội bộ)
    const stale = userRowCache.get(base.email.toLowerCase());
    const graceMs = 60_000;
    if (stale && stale.exp + graceMs > Date.now()) {
      const status = checkUserStatus(stale.row);
      if (!status.ok) return null;
      const sheetPass = pick(stale.row, ["Password", "MatKhau", "password"]);
      const nowSv = passwordFingerprint(sheetPass);
      if (payload.sv && payload.sv !== "0" && payload.sv !== nowSv) return null;
      console.warn("[Auth] verify sheet error — use stale cache", base.email);
      return base;
    }
    console.warn("[Auth] verify session sheet error — allow token", e);
    return base;
  }
}

/** Helper route: Bearer → user đã verify Sheet (null nếu revoke). */
export async function requireVerifiedUser(
  req: { headers: { get(name: string): string | null } }
): Promise<UserContext | null> {
  const token =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  return getCurrentUserVerified(token);
}

/** Role ADMIN (case-insensitive) hoặc permission `*`. */
export function isAdminRole(user: UserContext | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN") return true;
  return Array.isArray(user.permissions) && user.permissions.includes("*");
}

/**
 * Admin gate chuẩn: verified session + isAdminRole.
 * Dùng cho /admin/*, /debug/*, PATCH users.
 */
export async function requireAdminVerified(
  req: { headers: { get(name: string): string | null } }
): Promise<
  | { user: UserContext; error?: undefined }
  | { user?: undefined; error: { code: string; message: string; status: number } }
> {
  const user = await requireVerifiedUser(req);
  if (!user) {
    return {
      error: {
        code: "SESSION_REVOKED",
        message: "Phiên hết hạn hoặc tài khoản đã khóa / đổi mật khẩu",
        status: 401,
      },
    };
  }
  if (!isAdminRole(user)) {
    return {
      error: {
        code: "PERMISSION_DENIED",
        message: "Chỉ ADMIN",
        status: 403,
      },
    };
  }
  return { user };
}

export function resolveScope(user: UserContext): AccessScope {
  const role = String(user.role || "").toUpperCase();
  if (role === "ADMIN") {
    return { role: user.role, scopeType: "ALL" };
  }
  if (role === "DISPATCHER") {
    return {
      role: user.role,
      scopeType: "OWNER",
      ownerEmail: user.email,
    };
  }
  // Sales / Viewer / Kế toán (NCC hoặc KH) → scope khách hàng (V21 KH.Quanly)
  if (
    role === "ACCOUNT" ||
    role === "ACCOUNTANT" ||
    role === "CUSTOMER_ACCOUNTANT" ||
    role === "KT_KH" ||
    role === "SALES" ||
    role === "VIEWER"
  ) {
    return {
      role: user.role,
      scopeType: "OWN_CUSTOMER",
      quanly: user.quanly,
    };
  }
  // Manager / Purchase / còn lại → MANAGEMENT (NCC.Quanly)
  return {
    role: user.role,
    scopeType: "MANAGEMENT",
    quanly: user.quanly,
  };
}

export function hasPermission(user: UserContext, permission: string): boolean {
  if (user.permissions.includes("*")) return true;
  return user.permissions.includes(permission);
}

/** STEP 7 — ném PERMISSION_DENIED nếu thiếu quyền */
export function requirePermission(
  user: UserContext,
  permission: string,
  message?: string
): void {
  if (!hasPermission(user, permission)) {
    throw {
      code: "PERMISSION_DENIED",
      message: message || `Không có quyền ${permission}`,
    };
  }
}

/** Cần ≥1 trong danh sách */
export function requireAnyPermission(
  user: UserContext,
  permissions: string[],
  message?: string
): void {
  if (permissions.some((p) => hasPermission(user, p))) return;
  throw {
    code: "PERMISSION_DENIED",
    message: message || `Không có quyền (${permissions.join(" | ")})`,
  };
}


export function isAdmin(user: UserContext): boolean {
  return isAdminRole(user);
}

/** List users from sheet (Admin) — no passwords */
export async function listUsersFromSheet(): Promise<
  Array<{
    email: string;
    hoTen: string;
    role: string;
    quanly: string;
    active: boolean;
    trangThai: string;
    phongBan: string;
    dienThoai: string;
    lastLogin: string;
  }>
> {
  if (!isSheetsConfigured()) return [];
  try {
    const rows = await readSheetAsObjects(SHEETS.USER, {});
    return rows
      .map((row) => {
        const u = userFromSheetRow(row);
        if (!u) return null;
        const pickLocal = (keys: string[]) => {
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== "") return String(row[k]);
          }
          return "";
        };
        return {
          email: u.email,
          hoTen: u.hoTen,
          role: u.role,
          quanly: u.quanly,
          active: isActiveUser(row),
          trangThai: pickLocal(["TrangThai", "Status", "trangThai"]) || (isActiveUser(row) ? "Approved" : "Locked"),
          phongBan: pickLocal(["PhongBan", "Phong", "Department"]),
          dienThoai: pickLocal(["DienThoai", "Phone", "SDT"]),
          lastLogin: pickLocal(["LastLogin", "lastLogin"]),
        };
      })
      .filter(Boolean) as Array<{
      email: string;
      hoTen: string;
      role: string;
      quanly: string;
      active: boolean;
      trangThai: string;
      phongBan: string;
      dienThoai: string;
      lastLogin: string;
    }>;
  } catch (e) {
    console.error("[Auth] listUsersFromSheet", e);
    return [];
  }
}
