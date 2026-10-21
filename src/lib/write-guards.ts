import type { UserContext } from "@/types";
import { resolveScope } from "@/lib/auth";
import { applyListScopeFilter } from "@/lib/scope";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isAcghangId } from "@/lib/default-plan-kh";

/**
 * Pipeline: Auth → Permission → **Scope** → Business Rule.
 * Kiểm tra đơn cha nằm trong phạm vi user (parity _canAccessOrder_) trước khi ghi.
 * Đơn không tìm thấy → bỏ qua (service gọi sẽ tự báo NOT_FOUND).
 */
export async function assertOrderInScope(
  orderId: string | undefined | null,
  user: UserContext,
  year: number,
  message: string
): Promise<void> {
  const id = String(orderId || "").trim();
  if (!id) return;
  const scope = resolveScope(user);
  if (scope.scopeType === "ALL") return;
  const { OrderRepository } = await import("@/repositories/order.repository");
  const order = await OrderRepository.findById(id, year).catch(() => null);
  if (!order) return;
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
