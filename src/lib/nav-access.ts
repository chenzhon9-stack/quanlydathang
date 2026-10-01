/**
 * Tab / route visibility — Permission Matrix V21 (RBAC_Setup_V21).
 * UI chỉ hiện mục khi có ≥1 permission trong anyOf (hoặc *).
 */

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  anyOf: string[];
  rolesOnly?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Tổng quan",
    icon: "📊",
    anyOf: ["REPORT_VIEW", "*"],
    rolesOnly: ["ADMIN", "MANAGER"],
  },
  {
    href: "/orders",
    label: "Đơn hàng",
    icon: "📋",
    anyOf: ["ORDER_VIEW", "*"],
  },
  {
    href: "/details",
    label: "Chi tiết xe",
    icon: "🚚",
    anyOf: ["ORDER_VIEW", "ORDER_RECEIVE", "*"],
  },
  {
    href: "/deliveries",
    label: "Giao hàng",
    icon: "📦",
    anyOf: ["DELIVERY_VIEW", "*"],
  },
  {
    href: "/plans",
    label: "Kế hoạch SL",
    icon: "📈",
    anyOf: ["PLAN_VIEW", "KHSL_VIEW", "*"],
  },
  {
    href: "/reports/receiving",
    label: "Báo cáo",
    icon: "📑",
    anyOf: ["REPORT_VIEW", "*"],
  },
  {
    href: "/payables",
    label: "Công nợ NCC",
    icon: "💰",
    anyOf: ["PAYABLE_VIEW", "*"],
  },
  {
    href: "/prices",
    label: "Giá mua",
    icon: "🏷️",
    anyOf: ["PURCHASE_PRICE_VIEW", "PURCHASE_PRICE_UPDATE", "PAYABLE_VIEW", "*"],
    rolesOnly: ["ADMIN", "MANAGER", "PURCHASE", "ACCOUNTANT"],
  },
  {
    href: "/masters",
    label: "Danh mục",
    icon: "📚",
    anyOf: ["MASTER_UPDATE", "PURCHASE_PRICE_VIEW", "ORDER_CREATE", "*"],
    rolesOnly: ["ADMIN", "MANAGER", "PURCHASE"],
  },
  {
    href: "/users",
    label: "User & Quyền",
    icon: "👤",
    anyOf: ["USER_MANAGE", "USER_VIEW", "*"],
    rolesOnly: ["ADMIN"],
  },
];

export type ClientUser = {
  hoTen?: string;
  role?: string;
  permissions?: string[];
  email?: string;
};

export function readClientUser(): ClientUser {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("user") || "{}") as ClientUser;
  } catch {
    return {};
  }
}

export function clientHasPermission(
  user: ClientUser,
  permission: string
): boolean {
  const perms = user.permissions || [];
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

export function clientHasAny(user: ClientUser, permissions: string[]): boolean {
  if (!permissions.length) return true;
  return permissions.some((p) => clientHasPermission(user, p));
}

export function canSeeNavItem(user: ClientUser, item: NavItem): boolean {
  const role = String(user.role || "").toUpperCase();
  const perms = user.permissions || [];
  if (perms.includes("*") || role === "ADMIN") return true;
  if (item.rolesOnly?.length && !item.rolesOnly.includes(role)) return false;
  return clientHasAny(user, item.anyOf);
}

export function visibleNavItems(user: ClientUser): NavItem[] {
  return NAV_ITEMS.filter((item) => canSeeNavItem(user, item));
}

export function firstAllowedPath(user: ClientUser): string {
  const items = visibleNavItems(user);
  if (items.length) return items[0].href;
  return "/deliveries";
}

export function canAccessPath(user: ClientUser, pathname: string): boolean {
  const path = pathname || "/";
  if (path.startsWith("/reports")) {
    return clientHasAny(user, ["REPORT_VIEW", "*"]);
  }
  const items = visibleNavItems(user);
  return items.some((item) => {
    if (item.href.startsWith("/reports")) return path.startsWith("/reports");
    return path === item.href || path.startsWith(item.href + "/");
  });
}

export const ACTION = {
  orderCreate: ["ORDER_CREATE", "*"],
  /** Sửa đơn / thêm xe / batch — STEP 7 ORDER_UPDATE */
  orderUpdate: ["ORDER_UPDATE", "ORDER_CREATE", "*"],
  orderSend: ["ORDER_SEND", "*"],
  orderCancel: ["ORDER_CANCEL", "*"],
  orderReceive: ["ORDER_RECEIVE", "*"],
  deliveryUpdate: ["DELIVERY_UPDATE", "*"],
  planUpdate: ["PLAN_UPDATE", "*"],
  payableView: ["PAYABLE_VIEW", "*"],
  payableCreate: ["PAYABLE_CREATE", "*"],
  payableCancel: ["PAYABLE_CANCEL", "*"],
  reportView: ["REPORT_VIEW", "*"],
} as const;
