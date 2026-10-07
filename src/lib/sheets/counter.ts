/**
 * System_Counter — parity V21 + noCache + khóa
 *
 * Key: `{TYPE}-{yyMMdd}`  (HCM)
 * Code: `{TYPE}-{yyMMdd}-{####}`
 *
 * Cơ chế chống trùng:
 * 1. Process-local lock theo key (cùng instance Vercel không song song)
 * 2. Đọc COUNTER luôn noCache (không dùng sheet-cache 45s)
 * 3. Khóa mềm trên Sheet: dòng Key=`__LOCK__{key}` + TTL, verify holder
 * 4. Retry + backoff khi không lấy được lock / ghi lỗi
 */

import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
  readSheetAsObjects,
  updateSheetRowByKey,
  appendSheetRow,
} from "@/lib/sheets/dal";
import { counterDateKey } from "@/lib/sheets/date";
import { randomBytes } from "crypto";

export type CounterType = "CT" | "GH" | "KH" | "GM" | "CN" | "DD" | string;

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Process-local mutex theo key ─────────────────────────────
const processLocks = new Map<string, Promise<void>>();

async function withProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = processLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  // Chuỗi tiếp theo phải đợi gate hiện tại
  processLocks.set(
    key,
    prev.then(() => gate).catch(() => gate)
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    // Dọn nếu không còn waiter gắn gate này (best-effort)
  }
}

const LOCK_PREFIX = "__LOCK__";
const LOCK_TTL_MS = 12_000;
const HOLDER =
  process.env.VERCEL_REGION ||
  process.env.VERCEL_ID ||
  `pid-${process.pid}-${randomBytes(3).toString("hex")}`;

function lockKeyFor(counterKey: string): string {
  return `${LOCK_PREFIX}${counterKey}`;
}

/**
 * Khóa mềm trên sheet System_Counter.
 * Trả true nếu giữ được lock (holder khớp sau ghi).
 */
async function tryAcquireSheetLock(
  counterKey: string,
  year: number | undefined
): Promise<boolean> {
  const lk = lockKeyFor(counterKey);
  const now = Date.now();
  const rows = await readSheetAsObjects(SHEETS.COUNTER, {
    year,
    noCache: true,
  });
  const found = rows.find(
    (r) => String(r.Key || "").trim().toUpperCase() === lk.toUpperCase()
  );
  const updatedAt = found
    ? Date.parse(String(found.UpdatedAt || found.Updatedat || ""))
    : 0;
  const holder = found ? String(found.UpdatedBy || "").trim() : "";
  const expired =
    !found || !updatedAt || !Number.isFinite(updatedAt) || now - updatedAt > LOCK_TTL_MS;

  // Đang bị instance khác giữ
  if (!expired && holder && holder !== HOLDER) {
    return false;
  }

  const stamp = new Date(now).toISOString();
  if (found) {
    const row = await updateSheetRowByKey(
      SHEETS.COUNTER,
      "Key",
      String(found.Key || lk),
      {
        CurrentNo: 0,
        UpdatedAt: stamp,
        UpdatedBy: HOLDER,
      },
      year
    );
    if (row < 0) return false;
  } else {
    await appendSheetRow(
      SHEETS.COUNTER,
      {
        Key: lk,
        CurrentNo: 0,
        UpdatedAt: stamp,
        UpdatedBy: HOLDER,
      },
      year
    );
  }

  // Verify holder
  const check = await readSheetAsObjects(SHEETS.COUNTER, {
    year,
    noCache: true,
  });
  const row = check.find(
    (r) => String(r.Key || "").trim().toUpperCase() === lk.toUpperCase()
  );
  return !!(row && String(row.UpdatedBy || "").trim() === HOLDER);
}

async function releaseSheetLock(
  counterKey: string,
  year: number | undefined
): Promise<void> {
  const lk = lockKeyFor(counterKey);
  try {
    await updateSheetRowByKey(
      SHEETS.COUNTER,
      "Key",
      lk,
      {
        UpdatedAt: new Date(0).toISOString(),
        UpdatedBy: "",
      },
      year
    );
  } catch {
    /* best-effort */
  }
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

  return withProcessLock(key, async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < 6; attempt++) {
      let gotSheetLock = false;
      try {
        // 1) Khóa sheet (cross-instance soft lock)
        gotSheetLock = await tryAcquireSheetLock(key, y);
        if (!gotSheetLock) {
          await sleep(40 + attempt * 70 + Math.floor(Math.random() * 40));
          continue;
        }

        // 2) Đọc counter — luôn noCache
        const rows = await readSheetAsObjects(SHEETS.COUNTER, {
          year: y,
          noCache: true,
        });
        const found = rows.find(
          (r) =>
            String(r.Key || "").trim().toUpperCase() === key.toUpperCase() &&
            !String(r.Key || "").startsWith(LOCK_PREFIX)
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
            String(found.Key || key),
            {
              CurrentNo: newCurrent,
              UpdatedAt: now,
              UpdatedBy: email,
            },
            y
          );
          if (row < 0) {
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

        // 3) Xác nhận giá trị đã tăng (phát hiện ghi đè hiếm)
        const verify = await readSheetAsObjects(SHEETS.COUNTER, {
          year: y,
          noCache: true,
        });
        const after = verify.find(
          (r) =>
            String(r.Key || "").trim().toUpperCase() === key.toUpperCase() &&
            !String(r.Key || "").startsWith(LOCK_PREFIX)
        );
        const afterNo = after ? Number(after.CurrentNo) || 0 : 0;
        if (afterNo < newCurrent) {
          // Có vẻ bị ghi đè / race — thử lại
          lastErr = new Error(
            `Counter verify fail ${key}: expected>=${newCurrent} got=${afterNo}`
          );
          await sleep(50 + attempt * 60);
          continue;
        }

        return codes;
      } catch (e) {
        lastErr = e;
        await sleep(50 + attempt * 80);
      } finally {
        if (gotSheetLock) {
          await releaseSheetLock(key, y);
        }
      }
    }

    throw lastErr || new Error(`Không cấp được counter ${key}`);
  });
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
