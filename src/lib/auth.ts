import { MOCK_USERS } from "@/mocks/data";
import type { UserContext, AccessScope } from "@/types";

const sessions = new Map<string, { user: UserContext; expiresAt: number }>();

export function login(
  email: string,
  password: string
): { user: UserContext; token: string } | null {
  const record = MOCK_USERS[email.toLowerCase()];
  if (!record || record.password !== password) return null;

  const token = `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  sessions.set(token, { user: record.user, expiresAt });
  return { user: record.user, token };
}

export function logout(token: string) {
  sessions.delete(token);
}

export function getCurrentUser(token: string | null): UserContext | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session.user;
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
