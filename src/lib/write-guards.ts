import type { UserContext } from "@/types";
import { resolveWriteScope } from "@/lib/auth";
import { applyListScopeFilter, resolveAllowedCustomerIds } from "@/lib/scope";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isAcghangId } from "@/lib/default-plan-kh";

/**
 * Pipeline: Auth → Permission → **Write Scope** → Business Rule.
 * resolveWriteScope: DISPATCHER+VIEWER xem theo Quanly nhưng chỉ ghi đơn OWNER.
 * Đơn không tìm thấy → DENY (fail-closed).
 */
export async function assertOrderInScope(
  orderId: string | undefined | null,
  user: UserContext,
  year: number,
  message: string
): Promise<void> {
  const id = String(orderId || "").trim();
  if (!id) {
    throw { code: "PERMISSION_DENIED", message: message || "Thiếu mã đơn." };
  }
  const scope = resolveWriteScope(user);
  if (scope.scopeType === "ALL") return;
  const { OrderRepository } = await import("@/repositories/order.repository");
  const order = await OrderRepository.findById(id, year).catch(() => null);
  if (!order) {
    throw {
      code: "PERMISSION_DENIED",
      message: message || "Không tìm thấy đơn hoặc ngoài phạm vi ghi.",
    };
  }
  const visible = await applyListScopeFilter([order], scope, year);
  if (!visible.length) {
    throw { code: "PERMISSION_DENIED", message };
  }
}

/** Tập mã khách ảo (lowercase): LoaiKhach=VIRTUAL trong DM_KhachHang. */
export async function loadVirtualCustomerSet(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const khRows = await readSheetAsObjects(SHEETS.KH, {});
    for (const r of khRows) {
      if (String(r.LoaiKhach || "").trim().toUpperCase() === "VIRTUAL") {
        out.add(String(r.MaKh || r.MaKH || "").trim().toLowerCase());
      }
    }
  } catch {
    /* optional */
  }
  return out;
}

/** Khách ảo = VIRTUAL trong danh mục hoặc khách đệm acghang / acghangB / acghangR. */
export function isVirtualCustomerId(
  customerId: string | null | undefined,
  virtualSet: Set<string>
): boolean {
  const k = String(customerId || "").trim().toLowerCase();
  if (!k) return false;
  return isAcghangId(k) || virtualSet.has(k);
}

export const VIRTUAL_CUSTOMER_REAL_MSG =
  "Không được giao hàng thực tế cho khách ảo.";

/** THUE_NGOAI bắt buộc có ĐVT (MaDVT) — parity GAS. */
export function isThueNgoaiHtvt(htvtId: string | undefined | null): boolean {
  return String(htvtId || "").toUpperCase().includes("THUE");
}

/** Khách KHÔNG phải THẬT (LoaiKhach VIRTUAL / SYSTEM) — lowercase. Mặc định khách là REAL (GAS). */
export async function loadNonRealCustomerSet(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const khRows = await readSheetAsObjects(SHEETS.KH, {});
    for (const r of khRows) {
      const t = String(r.LoaiKhach || "").trim().toUpperCase();
      if (t === "VIRTUAL" || t === "SYSTEM") {
        out.add(String(r.MaKh || r.MaKH || "").trim().toLowerCase());
      }
    }
  } catch {
    /* optional */
  }
  return out;
}

/**
 * User chỉ có nhánh OWN_CUSTOMER (sales/accountant, không manager/purchase/dispatcher):
 * trả về tập KH được quản lý (parity GAS `isSalesOnly` + `_allowedCustomers_`).
 * Không phải sales-only → null (không hạn chế theo khách).
 */
export async function salesOnlyAllowedCustomers(
  user: UserContext
): Promise<Set<string> | null> {
  const scope = resolveScope(user);
  if (scope.scopeType !== "OWN_CUSTOMER") return null;
  if (scope.allowManagement || scope.allowOwner) return null;
  const set = await resolveAllowedCustomerIds(scope);
  return set ? new Set([...set].flatMap((x) => [x, x.toUpperCase()])) : null;
}

export function customerAllowed(
  customerId: string | undefined | null,
  allowed: Set<string> | null
): boolean {
  if (!allowed) return true;
  const k = String(customerId || "").trim();
  return !!k && (allowed.has(k) || allowed.has(k.toUpperCase()));
}
