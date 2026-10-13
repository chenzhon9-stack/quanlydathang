/*****************************************************************
 * PATCH V21.07 → V21.08: Vercel gửi đơn qua webhook
 * Action: sendOrderFromWebhook (không đụng DEPRECATED_ACTIONS)
 * Vercel: action "sendOrderFromWebhook" + body.secret + body.email + body.maDon
 *****************************************************************/

// ── (1) Global, cạnh DEPRECATED_ACTIONS ──
var _WEBHOOK_ACTOR_ = ""; // chỉ set trong doPost SAU secret hợp lệ

// ── (2) Trong _resolveEmailFromSession_: chèn TRƯỚC
//        if (_isSessionEnforced_()) return { email: "", via: "denied" };
/*
  if (_WEBHOOK_ACTOR_ && fallbackEmail && fallbackEmail === _WEBHOOK_ACTOR_) {
    return { email: fallbackEmail, via: "webhook" };
  }
*/

// ── (3) doPost: SAU khối ping, TRƯỚC DEPRECATED / UNKNOWN ──
/*
    if (action === "sendOrderFromWebhook") {
      var maDonS = String(body.maDon || "").trim();
      var actor  = String(body.email || "").trim().toLowerCase();
      var sAct   = String(body.sendAction || body.orderAction || "").trim();
      if (!/^No\./i.test(maDonS)) return _jsonOut_({ success: false, error: "maDon không hợp lệ." });
      if (!actor || !_isSafeEmail_(actor)) return _jsonOut_({ success: false, error: "Email actor không hợp lệ." });
      if (["", "send", "reset", "cancel", "markSent"].indexOf(sAct) < 0) {
        return _jsonOut_({ success: false, error: "sendAction không hợp lệ." });
      }
      _WEBHOOK_ACTOR_ = actor;
      try {
        _writeLog_("WEBHOOK_SEND_ORDER", "maDon=" + maDonS + " actor=" + actor + " act=" + sAct);
        return _jsonOut_(sendOrderEmail(maDonS, actor, sAct || null) || { success: false, error: "Empty response" });
      } finally {
        _WEBHOOK_ACTOR_ = "";
      }
    }
*/

/**
 * Lưu ý:
 * - SECRET bắt buộc ở đầu doPost (đã có).
 * - Quyền thực tế: sendOrderEmail → _checkPermission_ + _canAccessOrder_.
 * - Vercel KHÔNG tăng LanGui khi success.
 * - APP: Vercel sheet-only; OTP: Vercel SMTP.
 * - Không deploy file doPost sendOrderEmail cũ (ghi đè mất createPdf/OTP).
 */
