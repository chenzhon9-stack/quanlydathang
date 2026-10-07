/**
 * Shared GAS Web App client (doPost).
 * - Follow / manual redirect (script.google.com → googleusercontent)
 * - Detect HTML error pages vs JSON
 * - Timeout AbortController
 * - Optional in-memory idempotency (same instance, short TTL)
 */

const DEFAULT_TIMEOUT_MS = 55_000;

export type GasPostResult = {
  status: number;
  body: Record<string, unknown>;
  raw: string;
  aborted?: boolean;
  fromIdempotencyCache?: boolean;
};

/** process-local debounce for duplicate sends (serverless: best-effort per instance) */
const recentKeys = new Map<string, { at: number; result?: GasPostResult }>();
const IDEMP_TTL_MS = 90_000;

export function gasWebhookUrl(): string {
  return (
    process.env.GAS_SEND_ORDER_URL ||
    process.env.GAS_WEBHOOK_URL ||
    process.env.GAS_WEBAPP_URL ||
    ""
  ).trim();
}

export function gasWebhookSecret(): string {
  return (
    process.env.WEBHOOK_SECRET ||
    process.env.GAS_WEBHOOK_SECRET ||
    ""
  ).trim();
}

function looksLikeHtml(raw: string): boolean {
  const t = (raw || "").trim();
  return (
    /^<!DOCTYPE/i.test(t) ||
    /^<html[\s>]/i.test(t) ||
    /<head[\s>]/i.test(t.slice(0, 200))
  );
}

function parseBody(raw: string, status: number): Record<string, unknown> {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { success: false, error: `GAS HTTP ${status} — body rỗng` };
  }
  if (looksLikeHtml(trimmed)) {
    return {
      success: false,
      _gasHtml: true,
      error:
        `GAS trả HTML (HTTP ${status}) thay vì JSON. ` +
        `Apps Script → Deploy → Web app: Execute as Me, Who has access: Anyone; ` +
        `doPost phải ContentService JSON (không HtmlService). Deploy New version sau khi sửa.`,
    };
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      error: `GAS không phải JSON (HTTP ${status}): ${trimmed.slice(0, 120)}`,
    };
  }
}

/**
 * POST JSON tới GAS Web App.
 * Thử redirect:follow trước; nếu HTML/4xx → thử manual redirect.
 */
export async function postGasWebhook(
  payload: Record<string, unknown>,
  opts?: {
    timeoutMs?: number;
    /** Nếu set: trong TTL, request trùng key không gọi GAS lại (trả cache nếu có) */
    idempotencyKey?: string;
  }
): Promise<GasPostResult> {
  const url = gasWebhookUrl();
  if (!url) {
    return {
      status: 0,
      raw: "",
      body: {
        success: false,
        error: "Chưa cấu hình GAS_SEND_ORDER_URL (webhook Web App).",
      },
    };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idKey = opts?.idempotencyKey?.trim() || "";

  if (idKey) {
    const hit = recentKeys.get(idKey);
    if (hit && Date.now() - hit.at < IDEMP_TTL_MS) {
      if (hit.result) {
        return { ...hit.result, fromIdempotencyCache: true };
      }
      // In-flight: chờ ngắn rồi báo đang xử lý
      return {
        status: 409,
        raw: "",
        body: {
          success: false,
          error:
            "Yêu cầu gửi trùng đang được xử lý. Đợi 30–60s rồi kiểm tra LanGui trên Sheet trước khi bấm lại.",
          _idempotencyInFlight: true,
        },
        fromIdempotencyCache: true,
      };
    }
    recentKeys.set(idKey, { at: Date.now() });
  }

  const secret = gasWebhookSecret();
  const bodyObj = { ...payload };
  if (secret && bodyObj.secret === undefined) bodyObj.secret = secret;
  if (idKey && bodyObj.idempotencyKey === undefined) {
    bodyObj.idempotencyKey = idKey;
  }
  const bodyStr = JSON.stringify(bodyObj);

  async function post(
    target: string,
    mode: "follow" | "manual"
  ): Promise<GasPostResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: bodyStr,
        redirect: mode,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (mode === "manual" && res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) return post(loc, "follow");
    }
    const raw = await res.text();
    return { status: res.status, raw, body: parseBody(raw, res.status) };
  }

  try {
    let result = await post(url, "follow");
    if (result.body._gasHtml || (result.status >= 400 && result.body.success !== true)) {
      try {
        const second = await post(url, "manual");
        // Prefer JSON success
        if (second.body.success === true || !second.body._gasHtml) {
          result = second;
        }
      } catch {
        /* keep first */
      }
    }
    if (idKey) {
      recentKeys.set(idKey, { at: Date.now(), result });
      // prune
      if (recentKeys.size > 200) {
        const now = Date.now();
        for (const [k, v] of recentKeys) {
          if (now - v.at > IDEMP_TTL_MS) recentKeys.delete(k);
        }
      }
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = /abort/i.test(msg);
    const fail: GasPostResult = {
      status: 0,
      raw: "",
      aborted,
      body: {
        success: false,
        error: aborted
          ? `GAS không phản hồi trong ${timeoutMs / 1000}s (timeout). Kiểm tra LanGui trên Sheet trước khi gửi lại.`
          : msg,
      },
    };
    if (idKey) {
      // clear in-flight so retry allowed after timeout
      recentKeys.delete(idKey);
    }
    return fail;
  }
}

/** Ghi nhận kết quả sau khi recover từ Sheet (timeout nhưng LanGui đã tăng). */
export function rememberGasIdempotency(
  key: string,
  result: GasPostResult
): void {
  if (!key) return;
  recentKeys.set(key, { at: Date.now(), result });
}
