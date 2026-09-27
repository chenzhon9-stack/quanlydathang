/**
 * Web App entry — Vercel Strangler gọi sendOrderEmail (PDF + mail/Zalo).
 * Deploy: Deploy > New deployment > Web app > Execute as Me > Anyone
 * Vercel env: GAS_SEND_ORDER_URL = URL .../exec
 * Tuỳ chọn: GAS_WEBHOOK_SECRET + Script Property WEBHOOK_SECRET
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const secret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
    if (secret && body.secret !== secret) {
      return _jsonOut_({ success: false, error: "Unauthorized" });
    }

    const action = String(body.action || "");
    // Vercel gửi action: "sendOrderEmail"
    if (action === "sendOrderEmail" || action === "sendOrder") {
      const maDon = String(body.maDon || "").trim();
      const email = String(body.email || "").trim();
      // '' | send | reset | cancel | markSent
      const sendAction = String(body.sendAction || body.orderAction || "").trim();
      if (!maDon) return _jsonOut_({ success: false, error: "Thiếu maDon" });
      if (!email) return _jsonOut_({ success: false, error: "Thiếu email actor" });

      // Gọi đúng hàm V21 — KHÔNG tăng LanGui phía Vercel
      const res = sendOrderEmail(maDon, email, sendAction || null);
      return _jsonOut_(res || { success: false, error: "Empty response" });
    }

    return _jsonOut_({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return _jsonOut_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return _jsonOut_({ success: true, service: "quanlydathang-sendOrderEmail", ts: new Date().toISOString() });
}

function _jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
