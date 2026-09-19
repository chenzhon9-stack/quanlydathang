import { MOCK_USERS } from "@/mocks/data";
import type { UserContext, AccessScope, Role } from "@/types";
import { normalizeRole, permissionsForRole } from "@/lib/permissions";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

/**
 * Stateless session token — bắt buộc trên Vercel serverless.
 * Token = vh1.<base64url JSON { user, exp }>
 */

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

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
};

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
    const found = Object.keys(row).find(
      (h) => h.toLowerCase() === k.toLowerCase()
    );
    if (found && row[found] != null && String(row[found]).trim() !== "")
      return String(row[found]).trim();
  }
  return "";
}

function isActiveUser(row: Record<string, string>): boolean {
  const hoatDong = pick(row, ["HoatDong", "Active", "IsActive"]).toLowerCase();
  const trangThai = pick(row, ["TrangThai", "Status"]).toLowerCase();
  if (hoatDong === "false" || hoatDong === "0" || hoatDong === "không")
    return false;
  if (
    trangThai.includes("khóa") ||
    trangThai.includes("khoa") ||
    trangThai === "inactive" ||
    trangThai === "disabled"
  )
    return false;
  return true;
}

function userFromSheetRow(row: Record<string, string>): UserContext | null {
  const email = pick(row, ["Email", "email"]).toLowerCase();
  if (!email) return null;
  const role = normalizeRole(pick(row, ["Role", "VaiTro", "role"]));
  return {
    email,
    role,
    quanly: pick(row, ["Quanly", "QuanLy", "quanly"]) || "",
    hoTen: pick(row, ["HoTen", "Ho_Ten", "Name", "Ten"]) || email,
    permissions: permissionsForRole(role),
  };
}

async function loginFromSheet(
  email: string,
  password: string
): Promise<UserContext | null> {
  if (!isSheetsConfigured()) return null;
  try {
    const rows = await readSheetAsObjects(SHEETS.USER, {});
    const emailLc = email.toLowerCase();
    const row = rows.find(
      (r) => pick(r, ["Email", "email"]).toLowerCase() === emailLc
    );
    if (!row) {
      console.info("[Auth] User sheet: email not found", emailLc);
      return null;
    }
    if (!isActiveUser(row)) {
      console.info("[Auth] User inactive", emailLc);
      return null;
    }
    const sheetPass = pick(row, ["Password", "MatKhau", "password"]);
    // V21 legacy: so sánh plain text (GAS webapp)
    if (sheetPass !== password) {
      console.info("[Auth] Password mismatch for sheet user", emailLc);
      return null;
    }
    const user = userFromSheetRow(row);
    if (user) console.info("[Auth] Sheet login OK", user.email, user.role);
    return user;
  } catch (e) {
    console.error("[Auth] User sheet read failed", e);
    return null;
  }
}

function loginFromMock(
  email: string,
  password: string
): UserContext | null {
  const record = MOCK_USERS[email.toLowerCase()];
  if (!record || record.password !== password) return null;
  // rebuild permissions từ matrix (đồng bộ STEP 6)
  const role = record.user.role;
  return {
    ...record.user,
    permissions:
      role === "ADMIN" ? ["*"] : permissionsForRole(role as Role),
  };
}

export async function login(
  email: string,
  password: string
): Promise<{ user: UserContext; token: string } | null> {
  const emailLc = String(email).toLowerCase().trim();
  const pass = String(password);

  // 1) Sheet User (ưu tiên)
  let user = await loginFromSheet(emailLc, pass);
  // 2) Fallback mock (dev / khi sheet không có user)
  if (!user) user = loginFromMock(emailLc, pass);
  if (!user) return null;

  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: TokenPayload = { user, exp };
  const token = `vh1.${b64urlEncode(payload)}`;
  return { user, token };
}

export function logout(_token: string) {
  // Stateless
}

export function getCurrentUser(token: string | null): UserContext | null {
  if (!token) return null;
  if (!token.startsWith("vh1.")) return null;

  const raw = token.slice(4);
  const payload = b64urlDecode<TokenPayload>(raw);
  if (!payload?.user?.email || !payload.exp) return null;
  if (payload.exp < Date.now()) return null;

  // Refresh permissions from matrix (role in token may be stale matrix)
  const role = payload.user.role;
  if (role === "ADMIN") {
    payload.user.permissions = ["*"];
  } else if (!payload.user.permissions?.length) {
    payload.user.permissions = permissionsForRole(role);
  }
  return payload.user;
}

export function resolveScope(user: UserContext): AccessScope {
  if (user.role === "ADMIN") {
    return { role: user.role, scopeType: "ALL" };
  }
  if (user.role === "DISPATCHER") {
    return {
      role: user.role,
      scopeType: "OWNER",
      ownerEmail: user.email,
    };
  }
  if (user.role === "ACCOUNT") {
    return {
      role: user.role,
      scopeType: "OWN_CUSTOMER",
      // accountCustomerId resolve sau khi có mapping
    };
  }
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

export function isAdmin(user: UserContext): boolean {
  return user.role === ("ADMIN" as Role);
}
