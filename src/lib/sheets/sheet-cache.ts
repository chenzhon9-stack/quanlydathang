/**
 * In-memory cache đọc sheet (path nóng CT/GH/DH).
 * - Key: year|sheetName
 * - TTL mặc định 45s (SHEET_CACHE_TTL_MS)
 * - Invalidate sau mọi append/update
 *
 * Lưu ý serverless: cache theo instance Vercel (warm), không shared giữa instance.
 * Vẫn giảm mạnh quota Sheets khi user lướt tab / reload liên tiếp.
 */

type CacheEntry = {
  at: number;
  rows: Record<string, string>[];
};

const store = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 45_000;

function ttlMs(): number {
  const n = Number(process.env.SHEET_CACHE_TTL_MS || "");
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

export function sheetCacheKey(sheetName: string, year?: number): string {
  return `${year ?? "default"}|${sheetName}`;
}

export function getSheetCache(
  sheetName: string,
  year?: number
): Record<string, string>[] | null {
  const key = sheetCacheKey(sheetName, year);
  const hit = store.get(key);
  if (!hit) return null;
  const ttl = ttlMs();
  if (ttl === 0) return null;
  if (Date.now() - hit.at > ttl) {
    store.delete(key);
    return null;
  }
  return hit.rows;
}

export function setSheetCache(
  sheetName: string,
  rows: Record<string, string>[],
  year?: number
): void {
  const ttl = ttlMs();
  if (ttl === 0) return;
  store.set(sheetCacheKey(sheetName, year), {
    at: Date.now(),
    rows,
  });
}

/** Xóa cache 1 hoặc nhiều sheet (sau ghi). year omit → xóa mọi year của sheet đó. */
export function invalidateSheetCache(
  sheetNames?: string | string[],
  year?: number
): void {
  if (!sheetNames) {
    store.clear();
    return;
  }
  const names = Array.isArray(sheetNames) ? sheetNames : [sheetNames];
  if (year !== undefined) {
    for (const n of names) store.delete(sheetCacheKey(n, year));
    return;
  }
  for (const key of [...store.keys()]) {
    for (const n of names) {
      if (key.endsWith(`|${n}`)) store.delete(key);
    }
  }
}

export function sheetCacheStats(): { size: number; keys: string[] } {
  return { size: store.size, keys: [...store.keys()] };
}
