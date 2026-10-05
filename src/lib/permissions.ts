import type { Role } from "@/types";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects, appendSheetRow, updateSheetRowAt } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

/**
 * Permission Baseline V21 — STEP 6 / D85
 * Role = tập Permission; Service chỉ requirePermission, không check role name.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  /** STEP 7: ORDER_UPDATE / PLAN_UPDATE / PAYABLE_CANCEL — tách khỏi CREATE */
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
    "ORDER_UPDATE",
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
    // PAYABLE_CANCEL — admin only (void)
    "PURCHASE_PRICE_VIEW",
    "PURCHASE_PRICE_UPDATE",
    "KHSL_VIEW",
    "KHSL_UPDATE",
    "PLAN_VIEW",
    "PLAN_UPDATE",
  ],
  DISPATCHER: [
    "ORDER_VIEW",
    "ORDER_CREATE",
    "ORDER_UPDATE",
    "ORDER_SEND",
    "DELIVERY_VIEW",
    "DELIVERY_UPDATE",
    "DELIVERY_VIEW_ACTUAL_RECEIVE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
    // không PLAN_VIEW / KHSL_VIEW — ẩn tab Kế hoạch
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
    "DELIVERY_VIEW_ACTUAL_RECEIVE",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
    "PAYABLE_VIEW",
    "PAYABLE_CREATE",
    // không PAYABLE_CANCEL
  ],
  ACCOUNT: ["DELIVERY_VIEW", "REPORT_VIEW"],
  /** Kế toán khách hàng — chỉ GH + BC thực giao theo KH.Quanly */
  CUSTOMER_ACCOUNTANT: [
    "DELIVERY_VIEW",
    "DELIVERY_VIEW_ACTUAL_DELIVER",
    "REPORT_VIEW",
  ],
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
  CUSTOMER_ACCOUNTANT: "CUSTOMER_ACCOUNTANT",
  "KẾ TOÁN KH": "CUSTOMER_ACCOUNTANT",
  KETOANKH: "CUSTOMER_ACCOUNTANT",
  KT_KH: "CUSTOMER_ACCOUNTANT",
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

/** V21.07 multi-role: thứ tự role mạnh nhất (User.Role cache). */
export const ROLE_PRIORITY: Role[] = [
  "ADMIN",
  "MANAGER",
  "PURCHASE",
  "DISPATCHER",
  "ACCOUNTANT",
  "CUSTOMER_ACCOUNTANT",
  "SALES",
  "VIEWER",
  "ACCOUNT",
];

export function primaryRoleFromList(roles: Role[]): Role {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return roles[0] || ("VIEWER" as Role);
}

export async function resolvePermissionsFromSheets(
  email: string,
  legacyRole: Role
): Promise<{ role: Role; roles: Role[]; permissions: string[]; source: string }> {
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

  const primary: Role = primaryRoleFromList(roles);

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
    roles,
    permissions: Array.from(perms),
    source: fromSheet ? "RolePermissions+UserRoles" : "code-matrix",
  };
}

/**
 * V21.07 _replaceUserRoles_: soft-delete role không còn; bật/append role mới.
 * RoleCode lưu chữ thường trên sheet (parity GAS); normalize khi đọc.
 */
export async function replaceUserRoles(
  email: string,
  roleCodes: string[],
  meta: { updatedBy: string; source?: string }
): Promise<{ primary: Role; roles: Role[]; changed: number }> {
  const emailLc = String(email || "").trim().toLowerCase();
  const want = Array.from(
    new Set(
      roleCodes
        .map((r) => normalizeRole(String(r || "")))
        .filter(Boolean) as Role[]
    )
  );
  if (!want.length) {
    throw new Error("Cần chọn ít nhất 1 role");
  }
  const primary = primaryRoleFromList(want);
  const wantSet = new Set(want.map((r) => r.toUpperCase()));
  const source = meta.source || "admin";
  const now = new Date().toISOString();

  // Đọc raw sheet để có row index
  const mod = await import("@/lib/sheets/client");
  const sheets = mod.getSheetsClient();
  const spreadsheetId = mod.getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SHEETS.USER_ROLES,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values = res.data.values || [];
  const headers = ((values[0] || []) as string[]).map((h) =>
    String(h ?? "").trim()
  );
  const cEmail = headers.findIndex((h) => h.toLowerCase() === "email");
  const cRole = headers.findIndex(
    (h) => h.toLowerCase() === "rolecode" || h.toLowerCase() === "role"
  );
  const cActive = headers.findIndex((h) => h.toLowerCase() === "hoatdong");
  if (cEmail < 0 || cRole < 0) {
    // Sheet chưa có → append tất cả
    for (const r of want) {
      await appendSheetRow(SHEETS.USER_ROLES, {
        Email: emailLc,
        RoleCode: r.toLowerCase(),
        HoatDong: true,
        Source: source,
        UpdatedAt: now,
        UpdatedBy: meta.updatedBy,
      });
    }
    return { primary, roles: want, changed: want.length };
  }

  const existingByRole = new Map<string, { a1Row: number; active: boolean }>();
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const em = String(row[cEmail] ?? "").trim().toLowerCase();
    if (em !== emailLc) continue;
    const rc = normalizeRole(String(row[cRole] ?? ""));
    if (!rc) continue;
    const activeRaw = cActive >= 0 ? row[cActive] : true;
    const active =
      activeRaw === true ||
      activeRaw === 1 ||
      String(activeRaw).toLowerCase() === "true" ||
      String(activeRaw) === "";
    existingByRole.set(rc.toUpperCase(), { a1Row: i + 1, active });
  }

  let changed = 0;
  // Update existing
  for (const [rcUpper, info] of existingByRole) {
    const should = wantSet.has(rcUpper);
    if (should && !info.active) {
      await updateSheetRowAt(SHEETS.USER_ROLES, info.a1Row, {
        HoatDong: true,
        Source: source,
        UpdatedAt: now,
        UpdatedBy: meta.updatedBy,
      });
      changed++;
    } else if (!should && info.active) {
      await updateSheetRowAt(SHEETS.USER_ROLES, info.a1Row, {
        HoatDong: false,
        Source: source,
        UpdatedAt: now,
        UpdatedBy: meta.updatedBy,
      });
      changed++;
    }
  }
  // Append missing
  for (const r of want) {
    if (!existingByRole.has(r.toUpperCase())) {
      await appendSheetRow(SHEETS.USER_ROLES, {
        Email: emailLc,
        RoleCode: r.toLowerCase(),
        HoatDong: true,
        Source: source,
        UpdatedAt: now,
        UpdatedBy: meta.updatedBy,
      });
      changed++;
    }
  }

  return { primary, roles: want, changed };
}
