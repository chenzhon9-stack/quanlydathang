/**
 * AccessScope helpers — parity V21 `_parseQuanly_` / `_itemGroupAllowed_`
 * FACT: separator is semicolon `;` (not comma). "all" / "tất cả" = isAll.
 */
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import type { AccessScope } from "@/types";

export function stripVN(v: string): string {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** V21: split by `;` — also accept `,` for safety */
export function parseManagementGroups(value: string | undefined | null): {
  isAll: boolean;
  groups: string[];
} {
  const raw = String(value || "").trim();
  const norm = stripVN(raw);
  if (!raw) return { isAll: false, groups: [] };
  if (norm === "tat ca" || norm === "all") return { isAll: true, groups: [] };

  const parts = raw
    .split(/[;,]/)
    .map((x) => stripVN(x))
    .filter(Boolean);
  return { isAll: false, groups: parts };
}

export function hasGroupIntersection(
  userGroups: string[],
  resourceQuanly: string | undefined | null
): boolean {
  const resource = parseManagementGroups(resourceQuanly);
  if (resource.isAll) return true;
  if (!resource.groups.length) return false;
  const set = new Set(userGroups);
  return resource.groups.some((g) => set.has(g));
}

function isActiveFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v == null) return true; // empty = active (V21)
  const s = String(v).toLowerCase();
  if (["false", "0", "no", "không", "khoa", "khóa"].includes(s)) return false;
  return true;
}

/**
 * Hợp đồng scope IDs (P0 fail-closed):
 * - `null`  = ALL — chỉ khi scopeType ALL / quanly "tất cả" / OWNER lọc chỗ khác
 * - `Set` rỗng = DENIED / không có quyền / lỗi tải danh mục (không được xem)
 * - `Set` có phần tử = RESTRICTED
 *
 * Lỗi Sheets hoặc chưa cấu hình với role bị giới hạn → Set rỗng (DENIED),
 * KHÔNG trả null (tránh filter coi null = bỏ lọc = xem hết).
 */
export type ScopeIdSet = Set<string> | null;

/**
 * Map MaNCC → allowed for this scope (MANAGEMENT).
 * ADMIN/ALL → null means no filter.
 * OWNER → null (filter by createdBy elsewhere).
 */
export async function resolveAllowedSupplierIds(
  scope: AccessScope
): Promise<ScopeIdSet> {
  if (scope.scopeType === "ALL") return null;
  if (scope.scopeType === "OWNER") return null; // owner filters by email
  if (scope.scopeType === "OWN_CUSTOMER") return null; // customer later

  // MANAGEMENT
  const parsed = parseManagementGroups(scope.quanly);
  if (parsed.isAll) return null;
  if (!parsed.groups.length) {
    // no groups → empty set (see nothing) unless ADMIN already handled
    return new Set();
  }

  // Role bị giới hạn mà chưa cấu hình Sheets → DENIED (không fail-open)
  if (!isSheetsConfigured()) {
    console.warn(
      "[Scope] NCC: Sheets chưa cấu hình — DENIED (empty set) cho MANAGEMENT"
    );
    return new Set();
  }

  try {
    const rows = await readSheetAsObjects(SHEETS.NCC, {});
    const allowed = new Set<string>();
    for (const r of rows) {
      const ma = String(r.MaNCC || r.MaNcc || "").trim();
      if (!ma) continue;
      if (!isActiveFlag(r.HoatDong)) continue;
      const q = r.Quanly ?? r.QuanLy ?? "";
      if (hasGroupIntersection(parsed.groups, q)) {
        allowed.add(ma);
      }
    }
    console.info(
      `[Scope] MANAGEMENT groups=${parsed.groups.join("|")} allowedNCC=${allowed.size}`
    );
    return allowed;
  } catch (e) {
    console.error("[Scope] load NCC failed → DENIED (empty set)", e);
    return new Set(); // fail-closed
  }
}

export function filterBySupplierIds<T extends { supplierId?: string }>(
  items: T[],
  allowed: ScopeIdSet
): T[] {
  // null = ALL; Set (kể cả rỗng) = lọc nghiêm
  if (allowed == null) return items;
  return items.filter((x) => x.supplierId && allowed.has(x.supplierId));
}


/** SALES/MANAGEMENT: KH thuộc nhóm Quanly (V21 _allowedCustomers) */
export async function resolveAllowedCustomerIds(
  scope: AccessScope
): Promise<ScopeIdSet> {
  if (scope.scopeType === "ALL") return null;
  if (scope.scopeType === "OWNER") return null;

  const parsed = parseManagementGroups(scope.quanly);
  if (parsed.isAll) return null;
  if (!parsed.groups.length) return new Set();

  if (!isSheetsConfigured()) {
    console.warn(
      "[Scope] KH: Sheets chưa cấu hình — DENIED (empty set) cho role hạn chế"
    );
    return new Set();
  }

  try {
    const rows = await readSheetAsObjects(SHEETS.KH, {});
    const allowed = new Set<string>();
    for (const r of rows) {
      const ma = String(r.MaKh || r.MaKH || "").trim();
      if (!ma) continue;
      const hd = r.HoatDong;
      if (hd !== undefined && hd !== null && hd !== "") {
        const s = String(hd).toLowerCase();
        if (["false", "0", "no", "không", "khoa", "khóa"].includes(s)) continue;
      }
      if (hasGroupIntersection(parsed.groups, r.Quanly || r.QuanLy || "")) {
        allowed.add(ma);
      }
    }
    console.info(
      `[Scope] CUSTOMER groups=${parsed.groups.join("|")} allowedKH=${allowed.size}`
    );
    return allowed;
  } catch (e) {
    console.error("[Scope] load KH failed → DENIED (empty set)", e);
    return new Set(); // fail-closed
  }
}

export function filterByCustomerIds<T extends { customerId?: string }>(
  items: T[],
  allowed: ScopeIdSet
): T[] {
  if (allowed == null) return items;
  return items.filter((x) => x.customerId && allowed.has(x.customerId));
}

/**
 * V21 dispatcher: chỉ đơn DonHang.User === email.
 * @returns Set MaDon uppercase, hoặc null nếu không phải OWNER.
 */
export async function resolveOwnerOrderIdSet(
  scope: AccessScope,
  year?: number
): Promise<Set<string> | null> {
  const wantOwner =
    scope.scopeType === "OWNER" ||
    scope.scopeType === "UNION" ||
    !!scope.allowOwner;
  if (!wantOwner || !scope.ownerEmail) return null;
  const { OrderRepository } = await import("@/repositories/order.repository");
  const orders = await OrderRepository.findMany(
    year != null ? { year } : {}
  );
  const em = String(scope.ownerEmail).toLowerCase().trim();
  const set = new Set<string>();
  for (const o of orders) {
    if (String(o.createdBy || "").toLowerCase().trim() === em) {
      const id = String(o.orderId || "").trim().toUpperCase();
      if (id) set.add(id);
    }
  }
  return set;
}

/** Lọc dòng có orderId thuộc đơn do OWNER tạo. */
export function filterByOwnerOrderIds<T extends { orderId?: string }>(
  rows: T[],
  ownerOrderIds: Set<string> | null
): T[] {
  if (!ownerOrderIds) return rows;
  return rows.filter((r) =>
    ownerOrderIds.has(String(r.orderId || "").trim().toUpperCase())
  );
}

/**
 * V21.07 multi-role list filter — hợp các nhánh:
 * - OWNER: orderId ∈ đơn do mình tạo / createdBy
 * - MANAGEMENT: supplierId ∈ NCC được Quanly
 * - OWN_CUSTOMER: customerId ∈ KH được Quanly
 * Một nhánh match → giữ dòng (union).
 */
export async function applyListScopeFilter<
  T extends {
    orderId?: string;
    supplierId?: string;
    customerId?: string;
    createdBy?: string;
  }
>(rows: T[], scope: AccessScope, year?: number): Promise<T[]> {
  if (!rows.length) return rows;
  if (scope.scopeType === "ALL") return rows;

  const allowOwner =
    scope.scopeType === "OWNER" ||
    scope.scopeType === "UNION" ||
    !!scope.allowOwner;
  const allowMgmt =
    scope.scopeType === "MANAGEMENT" ||
    scope.scopeType === "UNION" ||
    !!scope.allowManagement;
  const allowCust =
    scope.scopeType === "OWN_CUSTOMER" ||
    scope.scopeType === "UNION" ||
    !!scope.allowOwnCustomer;

  // Single-branch fast paths (giữ hành vi cũ)
  if (allowOwner && !allowMgmt && !allowCust) {
    if (rows.some((r) => r.createdBy != null && r.orderId == null)) {
      // Order list style
      const em = String(scope.ownerEmail || "").toLowerCase();
      return rows.filter(
        (o) => String(o.createdBy || "").toLowerCase() === em
      );
    }
    const set = await resolveOwnerOrderIdSet(
      { ...scope, scopeType: "OWNER", allowOwner: true },
      year
    );
    return filterByOwnerOrderIds(rows, set);
  }
  if (allowMgmt && !allowOwner && !allowCust) {
    // Prefer supplier filter when rows have supplierId
    if (rows.some((r) => r.supplierId)) {
      const allowed = await resolveAllowedSupplierIds({
        ...scope,
        scopeType: "MANAGEMENT",
      });
      return filterBySupplierIds(rows, allowed);
    }
    if (rows.some((r) => r.customerId)) {
      const allowed = await resolveAllowedCustomerIds({
        ...scope,
        scopeType: "OWN_CUSTOMER",
      });
      return filterByCustomerIds(rows, allowed);
    }
    // P0: thiếu trường scope → DENIED (không trả nguyên list)
    console.warn(
      "[Scope] MANAGEMENT list thiếu supplierId/customerId — trả [] (không bỏ lọc)"
    );
    return [];
  }
  if (allowCust && !allowOwner && !allowMgmt) {
    const allowed = await resolveAllowedCustomerIds({
      ...scope,
      scopeType: "OWN_CUSTOMER",
    });
    return filterByCustomerIds(rows, allowed);
  }

  // UNION — load all needed sets
  let ownerSet: Set<string> | null = null;
  let nccAllowed: Set<string> | null = null;
  let khAllowed: Set<string> | null = null;
  const em = String(scope.ownerEmail || "").toLowerCase();

  if (allowOwner) {
    ownerSet = await resolveOwnerOrderIdSet(
      { ...scope, scopeType: "OWNER", allowOwner: true },
      year
    );
  }
  if (allowMgmt) {
    nccAllowed = await resolveAllowedSupplierIds({
      ...scope,
      scopeType: "MANAGEMENT",
    });
  }
  if (allowCust) {
    khAllowed = await resolveAllowedCustomerIds({
      ...scope,
      scopeType: "OWN_CUSTOMER",
    });
  }

  return rows.filter((r) => {
    if (
      allowOwner &&
      em &&
      String(r.createdBy || "").toLowerCase() === em
    ) {
      return true;
    }
    if (
      ownerSet &&
      r.orderId &&
      ownerSet.has(String(r.orderId).trim().toUpperCase())
    ) {
      return true;
    }
    if (
      nccAllowed &&
      r.supplierId &&
      (nccAllowed.has(String(r.supplierId)) ||
        nccAllowed.has(String(r.supplierId).toUpperCase()))
    ) {
      return true;
    }
    if (
      khAllowed &&
      r.customerId &&
      (khAllowed.has(String(r.customerId)) ||
        khAllowed.has(String(r.customerId).toUpperCase()))
    ) {
      return true;
    }
    return false;
  });
}
