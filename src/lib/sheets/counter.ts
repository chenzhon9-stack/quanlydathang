/**
 * System_Counter — parity V21 + noCache + khóa
 *
 * Key: `{TYPE}-{yyMMdd}`  (HCM)
 * Code: `{TYPE}-{yyMMdd}-{####}`
 *
 * Cơ chế chống trùng:
 * 1. Process-local lock theo key (cùng instance Vercel không song song)
 * 2. Đọc COUNTER luôn noCache (không dùng sheet-cache 45s)
 * 3. Khóa "vé nối đuôi" trên Sheet (append nguyên tử, vé còn hạn đầu tiên giữ khóa) — 1 khóa cho mọi loại mã
 * 4. Retry + backoff khi không lấy được lock / ghi lỗi
 */

import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import {
  readSheetAsObjects,
  updateSheetRowByKey,
  updateSheetRowsAt,
  appendSheetRows,
  deleteSheetRows,
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
/**
 * Khóa dạng "vé nối đuôi" (ticket lock) trên System_Counter:
 *  - Muốn cấp mã → APPEND 1 dòng vé {Key: __LOCKQ__, CurrentNo: hạn(epoch ms), UpdatedBy: token}.
 *    Thao tác append của Sheets là nguyên tử và có thứ tự → vé đầu tiên còn hạn là người giữ khóa.
 *  - Người chờ đọc lại sheet cho tới khi vé của mình đứng đầu.
 *  - Ghi counter + hết hạn vé (CurrentNo=0) trong CÙNG 1 lần batchUpdate.
 * Khác khóa "đọc → ghi → kiểm tra" cũ: không có khoảng hở giữa kiểm tra và ghi nên
 * không thể có 2 instance cùng giữ khóa (trước đây có thể cấp trùng mã khi lưu đồng thời).
 */
const TICKET_KEY = `${LOCK_PREFIX}Q`;
const TICKET_TTL_MS = 20_000;
const TICKET_WAIT_MS = 15_000;
const TICKET_CLEAN_THRESHOLD = 25;
/** Unique per process — KHÔNG dùng mỗi VERCEL_REGION (mọi instance cùng region trùng nhau). */
const HOLDER = [
  process.env.VERCEL_REGION || "local",
  process.pid,
  randomBytes(6).toString("hex"),
].join("-");

const isLockKey = (k: unknown) => String(k || "").startsWith(LOCK_PREFIX);
const isTicket = (r: Record<string, string>) => String(r.Key || "") === TICKET_KEY;
const upper = (k: unknown) => String(k || "").trim().toUpperCase();

async function takeTicket(year: number | undefined): Promise<string> {
  const token = `${HOLDER}-${randomBytes(4).toString("hex")}`;
  const now = Date.now();
  await appendSheetRows(
    SHEETS.COUNTER,
    [
      {
        Key: TICKET_KEY,
        CurrentNo: now + TICKET_TTL_MS,
        UpdatedAt: String(now),
        UpdatedBy: token,
      },
    ],
    year
  );
  return token;
}

/** Hết hạn vé (đường lỗi — đường thành công nhả cùng lúc ghi counter). */
async function expireTicket(token: string, year: number | undefined): Promise<void> {
  try {
    await updateSheetRowByKey(
      SHEETS.COUNTER,
      "UpdatedBy",
      token,
      { CurrentNo: 0, UpdatedAt: "0" },
      year
    );
  } catch {
    /* best-effort — vé tự hết hạn sau TTL */
  }
}

export type CounterRequest = {
  type: CounterType;
  dateValue?: string | number | Date | null;
  count?: number;
};

/**
 * Cấp mã cho NHIỀU loại/ngày trong 1 lần khóa (vd. CT + GH khi tạo đơn).
 * Trả về mảng mã theo đúng thứ tự `requests`.
 *
 * Số lời gọi Sheets (không tranh chấp): append vé(1) + đọc(1) + [thêm dòng key mới(1)]
 *   + ghi counter KÈM nhả vé(1) + đọc xác nhận(1) ≈ 4 — không phụ thuộc số loại mã
 *   (trước đây ~10 lời gọi cho MỖI loại). Khi có người khác đang giữ khóa, mỗi lần chờ thêm 1 lần đọc.
 */
export async function nextCounterCodesMulti(
  requests: CounterRequest[],
  opts?: { email?: string; year?: number }
): Promise<string[][]> {
  const reqs = requests.map((r) => ({
    type: r.type,
    key: `${r.type}-${counterDateKey(r.dateValue)}`,
    ymd: counterDateKey(r.dateValue),
    count: Math.max(1, Math.floor(r.count ?? 1)),
  }));

  if (!isSheetsConfigured()) {
    const base = Date.now() % 10000;
    return reqs.map((r, ri) =>
      Array.from(
        { length: r.count },
        (_, i) => `${r.type}-${r.ymd}-${pad4((base + ri * 100 + i) % 10000)}`
      )
    );
  }

  const y = opts?.year;
  const email = opts?.email || "system";

  return withProcessLock("COUNTER_ALL", async () => {
    let lastErr: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      let token: string | null = null;
      let released = true;
      try {
        // 1) Lấy vé (append nguyên tử)
        token = await takeTicket(y);
        released = false;

        // 2) Chờ tới lượt: vé còn hạn đầu tiên là của mình
        const deadline = Date.now() + TICKET_WAIT_MS;
        let rows: Record<string, string>[] = [];
        let myIdx = -1;
        for (let poll = 0; ; poll++) {
          rows = await readSheetAsObjects(SHEETS.COUNTER, {
            year: y,
            noCache: true,
          });
          const now = Date.now();
          myIdx = rows.findIndex(
            (r) => isTicket(r) && String(r.UpdatedBy || "").trim() === token
          );
          if (myIdx < 0 || !(Number(rows[myIdx].CurrentNo) > now)) {
            // vé hết hạn / mất → lấy vé mới
            token = await takeTicket(y);
            released = false;
            continue;
          }
          const first = rows.find((r) => isTicket(r) && Number(r.CurrentNo) > now);
          if (first && String(first.UpdatedBy || "").trim() === token) break;
          if (now > deadline) {
            throw new Error("Hết thời gian chờ khóa cấp mã (counter).");
          }
          await sleep(Math.min(300, 80 + poll * 40));
        }

        // 3) Đang giữ khóa → cấp mã dựa trên bản đọc vừa rồi
        const counterRowByKey = new Map<string, { a1Row: number; current: number }>();
        rows.forEach((r, i) => {
          if (isLockKey(r.Key)) return;
          const k = upper(r.Key);
          if (k && !counterRowByKey.has(k)) {
            counterRowByKey.set(k, {
              a1Row: i + 2,
              current: Math.max(0, Number(r.CurrentNo) || 0),
            });
          }
        });
        const cursor = new Map<string, number>();
        const results: string[][] = [];
        for (const r of reqs) {
          const ku = upper(r.key);
          const base = cursor.get(ku) ?? counterRowByKey.get(ku)?.current ?? 0;
          const codes: string[] = [];
          for (let n = 1; n <= r.count; n++) codes.push(`${r.key}-${pad4(base + n)}`);
          cursor.set(ku, base + r.count);
          results.push(codes);
        }

        // Dọn vé hết hạn khi tích tụ nhiều (hiếm — 1 lời gọi). PHẢI làm khi còn giữ khóa
        // và TRƯỚC khi ghi, vì xóa dòng làm dịch số dòng → quy đổi lại a1Row bên dưới.
        let shift = (a1: number) => a1;
        try {
          const now2 = Date.now();
          const staleIdx: number[] = [];
          rows.forEach((r, i) => {
            if (i !== myIdx && isTicket(r) && !(Number(r.CurrentNo) > now2)) staleIdx.push(i);
          });
          if (staleIdx.length >= TICKET_CLEAN_THRESHOLD) {
            await deleteSheetRows(
              SHEETS.COUNTER,
              staleIdx.map((i) => i + 2),
              y
            );
            const sorted = staleIdx.slice().sort((a, b) => a - b);
            shift = (a1: number) => {
              const idx = a1 - 2;
              let n = 0;
              for (const d of sorted) if (d < idx) n++;
              return a1 - n;
            };
          }
        } catch (e) {
          console.warn("[counter] dọn vé lỗi (bỏ qua)", e);
          shift = (a1: number) => a1; // xóa có thể chưa chạy → giữ nguyên số dòng
        }

        const iso = new Date().toISOString();
        const updates: Array<{
          a1Row: number;
          patch: Record<string, string | number | boolean>;
        }> = [];
        const appends: Array<Record<string, string | number | boolean>> = [];
        const keyCase = new Map(reqs.map((r) => [upper(r.key), r.key]));
        for (const [ku, newCurrent] of cursor) {
          const ex = counterRowByKey.get(ku);
          const patch = { CurrentNo: newCurrent, UpdatedAt: iso, UpdatedBy: email };
          if (ex) updates.push({ a1Row: shift(ex.a1Row), patch });
          else appends.push({ Key: keyCase.get(ku) || ku, ...patch });
        }
        if (appends.length) await appendSheetRows(SHEETS.COUNTER, appends, y);
        // ghi counter + NHẢ VÉ trong cùng 1 lần batchUpdate
        updates.push({
          a1Row: shift(myIdx + 2),
          patch: { CurrentNo: 0, UpdatedAt: "0" },
        });
        await updateSheetRowsAt(SHEETS.COUNTER, updates, y);
        released = true;

        // 4) Xác nhận giá trị đã tăng (phát hiện ghi đè ngoài cơ chế khóa, vd. GAS)
        const verify = await readSheetAsObjects(SHEETS.COUNTER, {
          year: y,
          noCache: true,
        });
        let ok = true;
        for (const [ku, newCurrent] of cursor) {
          const after = verify.find(
            (r) => !isLockKey(r.Key) && upper(r.Key) === ku
          );
          if ((after ? Number(after.CurrentNo) || 0 : 0) < newCurrent) ok = false;
        }
        if (!ok) {
          lastErr = new Error(`Counter verify fail ${reqs.map((r) => r.key).join(",")}`);
          await sleep(50 + attempt * 60);
          continue;
        }
        return results;
      } catch (e) {
        lastErr = e;
        await sleep(50 + attempt * 80);
      } finally {
        if (token && !released) await expireTicket(token, y);
      }
    }

    throw lastErr || new Error("Không cấp được counter");
  });
}

/**
 * Cấp `count` mã liên tiếp cho 1 loại.
 * dateValue: ngày nghiệp vụ (NgayDatHang / Ngaygiao / …)
 */
export async function nextCounterCodes(
  type: CounterType,
  dateValue?: string | number | Date | null,
  opts?: { count?: number; email?: string; year?: number }
): Promise<string[]> {
  const out = await nextCounterCodesMulti(
    [{ type, dateValue, count: opts?.count }],
    { email: opts?.email, year: opts?.year }
  );
  return out[0];
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
