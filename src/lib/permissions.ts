import type { Role } from "@/types";

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
