import type { Role } from "@/types";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

/**
 * Permission Baseline V21 — STEP 6 / D85
 * Role = tập Permission; Service chỉ requirePermission, không check role name.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ["*"],
  MANAGER: [
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_RECEIVE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "PLAN_VIEW",
    "REPORT_VIEW",
    "PAYABLE_VIEW",
    "PURCHASE_PRICE_VIEW",
    "KHSL_VIEW",
  ],
  PURCHASE: [
    "ORDER_VIEW",
    "ORDER_CREATE",
    "ORDER_RECEIVE",
    "ORDER_SEND",
    "ORDER_CANCEL",
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_RECEIVE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
    "PAYABLE_VIEW",
    "PAYABLE_CREATE",
    "PURCHASE_PRICE_VIEW",
    "PURCHASE_PRICE_UPDATE",
    "KHSL_VIEW",
    "KHSL_UPDATE",
  ],
  DISPATCHER: [
    "ORDER_VIEW",
    "ORDER_CREATE",
    "ORDER_SEND",
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_RECEIVE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
    "KHSL_VIEW",
  ],
  SALES: [
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
  ],
  VIEWER: [
    "DELIVERY_VIEW",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
  ],
  ACCOUNTANT: [
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
    "PAYABLE_VIEW",
    "PAYABLE_CREATE",
  ],
  ACCOUNT: ["DELIVERY_VIEW", "REPORT_VIEW"],
};

const ROLE_ALIASES: Record<string, Role> = {
  ADMIN: "ADMIN",
  QUANTRI: "ADMIN",
  "QUẢN TRỊ": "ADMIN",
  MANAGER: "MANAGER",
  QUANLY: "MANAGER",
  "QUẢN LÝ": "MANAGER",
  PURCHASE: "PURCHASE",
  MUAHANG: "PURCHASE",
  "MUA HÀNG": "PURCHASE",
  DISPATCHER: "DISPATCHER",
  DIEUPHOI: "DISPATCHER",
  "ĐIỀU PHỐI": "DISPATCHER",
  SALES: "SALES",
  BANHANG: "SALES",
  "BÁN HÀNG": "SALES",
  VIEWER: "VIEWER",
  XEM: "VIEWER",
  ACCOUNTANT: "ACCOUNTANT",
  KETOAN: "ACCOUNTANT",
  "KẾ TOÁN": "ACCOUNTANT",
  ACCOUNT: "ACCOUNT",
};

export function normalizeRole(raw: string): Role {
  const key = String(raw || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // try exact then folded without accents
  if (ROLE_ALIASES[String(raw || "").trim().toUpperCase()]) {
    return ROLE_ALIASES[String(raw || "").trim().toUpperCase()];
  }
  for (const [k, v] of Object.entries(ROLE_ALIASES)) {
    if (k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === key) return v;
  }
  // common ascii folds
  if (key === "QUANTRI") return "ADMIN";
  if (key === "QUANLY") return "MANAGER";
  if (key === "MUAHANG") return "PURCHASE";
  if (key === "DIEUPHOI") return "DISPATCHER";
  if (key === "BANHANG") return "SALES";
  if (key === "KETOAN") return "ACCOUNTANT";
  return "VIEWER";
}

export function permissionsForRole(role: Role): string[] {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.VIEWER;
}


/** Cache RolePermissions sheet */
let _rpCache: { at: number; byRole: Record<string, string[]> } | null = null;
const RP_TTL = 60_000;

async function loadRolePermissionMap(): Promise<Record<string, string[]>> {
  if (_rpCache && Date.now() - _rpCache.at < RP_TTL) return _rpCache.byRole;
  const byRole: Record<string, string[]> = {};
  if (!isSheetsConfigured()) {
    _rpCache = { at: Date.now(), byRole };
    return byRole;
  }
  try {
    const rows = await readSheetAsObjects(SHEETS.ROLE_PERMISSIONS, {});
    for (const r of rows) {
      const active = String(r.HoatDong ?? "true").toLowerCase();
      if (active === "false" || active === "0") continue;
      const role = normalizeRole(String(r.RoleCode || ""));
      const perm = String(r.PermCode || "").trim();
      if (!perm) continue;
      if (!byRole[role]) byRole[role] = [];
      if (!byRole[role].includes(perm)) byRole[role].push(perm);
    }
    _rpCache = { at: Date.now(), byRole };
    console.info("[RBAC] RolePermissions roles=", Object.keys(byRole).length);
  } catch {
    console.info("[RBAC] RolePermissions unavailable — code matrix");
  }
  return byRole;
}

/**
 * Effective role từ UserRoles (nếu có) else User.Role.
 * Permissions từ RolePermissions sheet else ROLE_PERMISSIONS (D85).
 * Đồng bộ RBAC_Setup_V21.gs seed matrix.
 */
export async function resolvePermissionsFromSheets(
  email: string,
  legacyRole: Role
): Promise<{ role: Role; permissions: string[]; source: string }> {
  let roles: Role[] = [];
  if (isSheetsConfigured()) {
    try {
      const ur = await readSheetAsObjects(SHEETS.USER_ROLES, {});
      const emailLc = email.toLowerCase();
      for (const r of ur) {
        if (String(r.Email || "").trim().toLowerCase() !== emailLc) continue;
        const active = String(r.HoatDong ?? "true").toLowerCase();
        if (active === "false" || active === "0") continue;
        const rc = normalizeRole(String(r.RoleCode || ""));
        if (rc && !roles.includes(rc)) roles.push(rc);
      }
    } catch {
      /* optional sheet */
    }
  }
  if (!roles.length) roles = [legacyRole];

  const primary: Role = roles.includes("ADMIN" as Role)
    ? ("ADMIN" as Role)
    : roles[0] || legacyRole;

  const sheetMap = await loadRolePermissionMap();
  const perms = new Set<string>();
  let fromSheet = false;
  for (const role of roles) {
    const list = sheetMap[role];
    if (list && list.length) {
      fromSheet = true;
      list.forEach((p) => perms.add(p));
    } else {
      permissionsForRole(role).forEach((p) => perms.add(p));
    }
  }
  if (primary === "ADMIN") perms.add("*");

  return {
    role: primary,
    permissions: Array.from(perms),
    source: fromSheet ? "RolePermissions+UserRoles" : "code-matrix",
  };
}
