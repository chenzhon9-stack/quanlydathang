/**
 * System_Counter — parity V21 _nextCounterCodesNoLock_
 *
 * Key: `{TYPE}-{yyMMdd}`  (HCM)
 * Code: `{TYPE}-{yyMMdd}-{####}`
 * Types: CT | GH | KH | GM | CN | DD | …
 *
 * Ghi chú concurrency: Sheets không có LockService phía server Next.
 * Dùng read-modify-write + retry ngắn. Production cao tải nên queue/lock riêng.
 */

import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
  readSheetAsObjects,
  updateSheetRowByKey,
  appendSheetRow,
} from "@/lib/sheets/dal";
import { counterDateKey } from "@/lib/sheets/date";

export type CounterType = "CT" | "GH" | "KH" | "GM" | "CN" | "DD" | string;

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * Cấp `count` mã liên tiếp.
 * dateValue: ngày nghiệp vụ (NgayDatHang / Ngaygiao / …)
 */
export async function nextCounterCodes(
  type: CounterType,
  dateValue?: string | number | Date | null,
  opts?: { count?: number; email?: string; year?: number }
): Promise<string[]> {
  const count = Math.max(1, Math.floor(opts?.count ?? 1));
  if (!isSheetsConfigured()) {
    // Dev / mock: timestamp-based fallback (không ghi Sheet)
    const ymd = counterDateKey(dateValue);
    const base = Date.now() % 10000;
    return Array.from({ length: count }, (_, i) =>
      `${type}-${ymd}-${pad4((base + i) % 10000)}`
    );
  }

  const y = opts?.year;
  const ymd = counterDateKey(dateValue);
  const key = `${type}-${ymd}`;
  const email = opts?.email || "system";

  // Retry read-modify-write
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = await readSheetAsObjects(SHEETS.COUNTER, { year: y });
      const found = rows.find(
        (r) => String(r.Key || "").trim().toUpperCase() === key.toUpperCase()
      );
      let current = found ? Number(found.CurrentNo) || 0 : 0;
      if (!Number.isFinite(current) || current < 0) current = 0;

      const codes: string[] = [];
      for (let n = 1; n <= count; n++) {
        codes.push(`${key}-${pad4(current + n)}`);
      }
      const newCurrent = current + count;
      const now = new Date().toISOString();

      if (found) {
        const row = await updateSheetRowByKey(
          SHEETS.COUNTER,
          "Key",
          key,
          {
            CurrentNo: newCurrent,
            UpdatedAt: now,
            UpdatedBy: email,
          },
          y
        );
        // Nếu key case mismatch — updateSheetRowByKey may fail
        if (row < 0) {
          // try append as new
          await appendSheetRow(
            SHEETS.COUNTER,
            {
              Key: key,
              CurrentNo: newCurrent,
              UpdatedAt: now,
              UpdatedBy: email,
            },
            y
          );
        }
      } else {
        await appendSheetRow(
          SHEETS.COUNTER,
          {
            Key: key,
            CurrentNo: newCurrent,
            UpdatedAt: now,
            UpdatedBy: email,
          },
          y
        );
      }
      return codes;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50 + attempt * 80));
    }
  }
  throw lastErr || new Error(`Không cấp được counter ${key}`);
}

export async function nextCounterCode(
  type: CounterType,
  dateValue?: string | number | Date | null,
  opts?: { email?: string; year?: number }
): Promise<string> {
  const codes = await nextCounterCodes(type, dateValue, { ...opts, count: 1 });
  return codes[0];
}

/** Helpers semantic */
export const newDetailId = (
  dateValue?: string | number | Date | null,
  opts?: { email?: string; year?: number }
) => nextCounterCode("CT", dateValue, opts);

export const newDeliveryId = (
  dateValue?: string | number | Date | null,
  opts?: { email?: string; year?: number }
) => nextCounterCode("GH", dateValue, opts);

/** Client temp id — không lưu Sheet */
export function isTempClientId(id: string | null | undefined): boolean {
  const s = String(id || "").trim().toUpperCase();
  if (!s) return true;
  if (s.startsWith("NEW") || s.startsWith("TMP")) return true;
  // GH + timestamp số dài (mẫu cũ)
  if (/^GH\d{8,}$/.test(s)) return true;
  return false;
}

/** GH chuẩn: GH-YYMMDD-#### */
export function isStandardGhId(id: string | null | undefined): boolean {
  return /^GH-\d{6}-\d{4}$/i.test(String(id || "").trim());
}

export function isStandardCtId(id: string | null | undefined): boolean {
  return /^CT-\d{6}-\d{4}$/i.test(String(id || "").trim());
}
