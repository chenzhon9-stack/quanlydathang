import { MOCK_USERS } from "@/mocks/data";
import type { UserContext, AccessScope, Role } from "@/types";

/**
 * Stateless session token — bắt buộc trên Vercel serverless.
 * Map in-memory bị mất giữa các instance → luôn "Chưa đăng nhập".
 * Token = base64url(JSON { user, exp })  (phase mock; sau dùng JWT + secret)
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

export function login(
  email: string,
  password: string
): { user: UserContext; token: string } | null {
  const record = MOCK_USERS[email.toLowerCase()];
  if (!record || record.password !== password) return null;

  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: TokenPayload = { user: record.user, exp };
  const token = `vh1.${b64urlEncode(payload)}`;
  return { user: record.user, token };
}

export function logout(_token: string) {
  // Stateless: client xóa localStorage là đủ
}

export function getCurrentUser(token: string | null): UserContext | null {
  if (!token) return null;

  // Hỗ trợ token cũ mock_... (sẽ fail → bắt login lại)
  if (!token.startsWith("vh1.")) return null;

  const raw = token.slice(4);
  const payload = b64urlDecode<TokenPayload>(raw);
  if (!payload?.user?.email || !payload.exp) return null;
  if (payload.exp < Date.now()) return null;

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

/** Role helpers for UI */
export function isAdmin(user: UserContext): boolean {
  return user.role === ("ADMIN" as Role);
}
