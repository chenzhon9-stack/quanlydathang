import type { UserContext } from "@/types";
import { resolveWriteScope } from "@/lib/auth";
import { applyListScopeFilter } from "@/lib/scope";
import { currentYearVN } from "@/lib/sheets/date";

/**
 * Tập MaDon user được **ghi** (resolveWriteScope).
 * Dùng gắn `canWrite` trên list CT/GH và khóa modal.
 * Fail-closed: lỗi → Set rỗng.
 */
export async function resolveWritableOrderIdSet(
  user: UserContext,
  year?: number
): Promise<Set<string> | "ALL"> {
  const writeScope = resolveWriteScope(user);
  if (writeScope.scopeType === "ALL") return "ALL";
  try {
    const { OrderRepository } = await import(
      "@/repositories/order.repository"
    );
    const y = year ?? currentYearVN();
    const orders = await OrderRepository.findMany({ year: y });
    const writable = await applyListScopeFilter(orders, writeScope, y);
    return new Set(
      writable.map((o) => String(o.orderId || "").trim().toUpperCase())
    );
  } catch (e) {
    console.error("[resolveWritableOrderIdSet]", e);
    return new Set();
  }
}

export function orderIdWritable(
  orderId: string | undefined | null,
  writable: Set<string> | "ALL"
): boolean {
  if (writable === "ALL") return true;
  const id = String(orderId || "").trim().toUpperCase();
  if (!id) return false;
  return writable.has(id);
}
