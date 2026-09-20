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
 * Map MaNCC → allowed for this scope (MANAGEMENT).
 * ADMIN/ALL → null means no filter.
 * OWNER → null (filter by createdBy elsewhere).
 */
export async function resolveAllowedSupplierIds(
  scope: AccessScope
): Promise<Set<string> | null> {
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

  if (!isSheetsConfigured()) return null;

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
    console.error("[Scope] load NCC failed", e);
    return null; // fail open for read? prefer fail closed:
  }
}

export function filterBySupplierIds<T extends { supplierId?: string }>(
  items: T[],
  allowed: Set<string> | null
): T[] {
  if (!allowed) return items;
  return items.filter((x) => x.supplierId && allowed.has(x.supplierId));
}
