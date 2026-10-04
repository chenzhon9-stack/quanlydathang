/**
 * Hybrid send Phase A (D151–D152): gọi GAS createOrderPdf qua doPost.
 * createPdf KHÔNG tăng LanGui — chỉ trả pdfUrl.
 */
const GAS_TIMEOUT_MS = 55_000;

export type CreatePdfResult =
  | {
      ok: true;
      pdfUrl: string;
      pdfFileId?: string;
      fileName?: string;
    }
  | {
      ok: false;
      error: string;
      httpStatus?: number;
      raw?: string;
    };

function gasWebhookUrl(): string {
  return (
    process.env.GAS_SEND_ORDER_URL ||
    process.env.GAS_WEBHOOK_URL ||
    process.env.GAS_WEBAPP_URL ||
    ""
  ).trim();
}

/**
 * POST { action: "createPdf", maDon, secret? }
 * Yêu cầu GAS doPost đã nhận action createPdf → createOrderPdf(maDon).
 */
export async function gasCreateOrderPdf(
  maDon: string,
  opts?: { year?: number }
): Promise<CreatePdfResult> {
  const url = gasWebhookUrl();
  if (!url) {
    return {
      ok: false,
      error: "Chưa cấu hình GAS_SEND_ORDER_URL (webhook Web App).",
    };
  }
  const secret =
    process.env.WEBHOOK_SECRET || process.env.GAS_WEBHOOK_SECRET || "";
  const payload: Record<string, unknown> = {
    action: "createPdf",
    maDon: String(maDon || "").trim(),
  };
  if (opts?.year) payload.year = opts.year;
  if (secret) payload.secret = secret;

  const bodyStr = JSON.stringify(payload);

  async function post(
    target: string,
    mode: "follow" | "manual"
  ): Promise<{ status: number; raw: string; body: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
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
    const trimmed = (raw || "").trim();
    const looksHtml =
      /^<!DOCTYPE/i.test(trimmed) ||
      /^<html[\s>]/i.test(trimmed) ||
      /<head[\s>]/i.test(trimmed.slice(0, 200));
    let body: Record<string, unknown> = {};
    try {
      if (looksHtml) throw new Error("html");
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {
        success: false,
        error:
          `GAS trả HTML (HTTP ${res.status}) — deploy doPost action createPdf (ContentService JSON).`,
      };
    }
    return { status: res.status, raw, body };
  }

  try {
    let result = await post(url, "follow");
    if (result.body._gasHtml || result.status >= 400) {
      try {
        result = await post(url, "manual");
      } catch {
        /* keep first */
      }
    }
    const b = result.body;
    if (b.success === true || b.ok === true) {
      return {
        ok: true,
        pdfUrl: String(b.pdfUrl || ""),
        pdfFileId: b.pdfFileId ? String(b.pdfFileId) : undefined,
        fileName: b.fileName ? String(b.fileName) : undefined,
      };
    }
    return {
      ok: false,
      error: String(b.error || "createPdf thất bại"),
      httpStatus: result.status,
      raw: result.raw?.slice(0, 300),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = /abort/i.test(msg);
    return {
      ok: false,
      error: aborted
        ? `GAS createPdf timeout ${GAS_TIMEOUT_MS / 1000}s`
        : msg,
    };
  }
}
