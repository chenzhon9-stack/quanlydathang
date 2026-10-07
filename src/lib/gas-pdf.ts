/**
 * Hybrid: GAS chỉ tạo PDF (createPdf) — không tăng LanGui.
 * Vercel gửi Mail/Zalo riêng (phase B).
 */
import { postGasWebhook, gasWebhookUrl } from "@/lib/gas-webhook";

export type CreatePdfResult = {
  ok: boolean;
  pdfUrl?: string;
  pdfFileId?: string;
  fileName?: string;
  error?: string;
  httpStatus?: number;
  raw?: string;
};

/**
 * POST { action: "createPdf", maDon, secret? }
 * Yêu cầu GAS doPost đã nhận action createPdf → createOrderPdf(maDon).
 */
export async function createOrderPdfViaGas(
  maDon: string,
  opts?: { year?: number }
): Promise<CreatePdfResult> {
  if (!gasWebhookUrl()) {
    return {
      ok: false,
      error: "Chưa cấu hình GAS_SEND_ORDER_URL (webhook Web App).",
    };
  }

  const payload: Record<string, unknown> = {
    action: "createPdf",
    maDon: String(maDon || "").trim(),
  };
  if (opts?.year) payload.year = opts.year;

  const result = await postGasWebhook(payload, {
    timeoutMs: 55_000,
    idempotencyKey: `pdf:${String(maDon || "").trim()}`,
  });

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
    httpStatus: result.status || undefined,
    raw: result.raw?.slice(0, 300),
  };
}
