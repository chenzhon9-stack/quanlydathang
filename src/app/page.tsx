"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { firstAllowedPath, type ClientUser } from "@/lib/nav-access";

const REMEMBER_EMAIL_KEY = "vh_login_email";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Quên/Đổi mật khẩu (V21)
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotErr, setForgotErr] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch {
      /* ignore */
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message || "Đăng nhập thất bại");
        return;
      }
      localStorage.setItem("token", json.data.session.token);
      localStorage.setItem("user", JSON.stringify(json.data.user));
      try {
        if (rememberEmail && email.trim()) {
          localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
        } else {
          localStorage.removeItem(REMEMBER_EMAIL_KEY);
        }
      } catch {
        /* ignore */
      }
      const u = (json.data.user || {}) as ClientUser;
      router.push(firstAllowedPath(u));
    } catch {
      setError("Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  }

  function openForgot() {
    setForgotEmail(email.trim());
    setOtp("");
    setNewPass("");
    setNewPass2("");
    setForgotMsg("");
    setForgotErr("");
    setOtpSent(false);
    setForgotOpen(true);
  }

  async function requestOtp() {
    setForgotBusy(true);
    setForgotErr("");
    setForgotMsg("");
    try {
      const res = await fetch("/api/v1/auth/password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        setForgotErr(json.error?.message || "Không gửi được OTP");
        return;
      }
      setOtpSent(true);
      setForgotMsg(
        json.meta?.message ||
          json.data?.message ||
          "Nếu email tồn tại, mã OTP đã được gửi (15 phút)."
      );
    } catch {
      setForgotErr("Không kết nối được máy chủ");
    } finally {
      setForgotBusy(false);
    }
  }

  async function submitReset() {
    setForgotBusy(true);
    setForgotErr("");
    setForgotMsg("");
    try {
      const res = await fetch("/api/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: forgotEmail.trim(),
          otp: otp.trim(),
          newPassword: newPass,
          confirmPassword: newPass2,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setForgotErr(json.error?.message || "Đổi mật khẩu thất bại");
        return;
      }
      setForgotMsg(
        json.meta?.message ||
          json.data?.message ||
          "Đổi mật khẩu thành công. Hãy đăng nhập."
      );
      setEmail(forgotEmail.trim());
      setPassword("");
      setTimeout(() => setForgotOpen(false), 1500);
    } catch {
      setForgotErr("Không kết nối được máy chủ");
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm bg-slate-800/90 rounded-2xl shadow-xl border border-slate-700 p-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🚛</div>
          <h1 className="text-xl font-bold text-sky-400 tracking-wide">
            VIẾT HẢI
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Hệ thống quản lý vận tải
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-3"
          autoComplete="on"
          method="post"
        >
          <input
            id="login-email"
            name="username"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="w-full px-3.5 py-2.5 rounded-lg border-0 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
            required
          />
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu"
            className="w-full px-3.5 py-2.5 rounded-lg border-0 text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
            required
          />

          <label className="flex items-center gap-2 text-xs text-slate-400 select-none">
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
              className="rounded border-slate-500"
            />
            Ghi nhớ email trên thiết bị này
          </label>

          {error && (
            <div className="text-red-300 text-xs bg-red-950/50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm transition disabled:opacity-50"
          >
            {loading ? "Đang đăng nhập..." : "ĐĂNG NHẬP"}
          </button>
        </form>

        <div className="mt-4 flex gap-2 justify-center">
          <button
            type="button"
            onClick={() =>
              alert(
                "Đăng ký tài khoản: dùng luồng V21 (OTP email) — sẽ bổ sung UI đăng ký đầy đủ. Liên hệ admin để được duyệt."
              )
            }
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600"
          >
            Đăng ký tài khoản mới
          </button>
          <button
            type="button"
            onClick={openForgot}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600"
          >
            Quên/Đổi mật khẩu
          </button>
        </div>
      </div>

      {/* Modal Quên/Đổi mật khẩu — parity V21 */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Quên mật khẩu</h3>
              <button
                type="button"
                className="text-slate-400 text-lg"
                onClick={() => setForgotOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              Nhập email → nhận mã OTP (15 phút) → đặt mật khẩu mới (≥8 ký tự, có
              chữ và số). Mật khẩu do chính bạn quản lý; admin không đặt hộ.
            </p>
            <label className="block text-xs text-slate-600">
              Email
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="email@example.com"
              />
            </label>
            <button
              type="button"
              disabled={forgotBusy || !forgotEmail.trim()}
              onClick={() => void requestOtp()}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-slate-200 text-slate-800 disabled:opacity-50"
            >
              {forgotBusy && !otpSent ? "Đang gửi…" : "Gửi mã OTP"}
            </button>
            <hr className="border-slate-100" />
            <label className="block text-xs text-slate-600">
              Mã OTP
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="6 số"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Mật khẩu mới
              <input
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                autoComplete="new-password"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Nhập lại mật khẩu mới
              <input
                type="password"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                autoComplete="new-password"
              />
            </label>
            {forgotErr && (
              <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                {forgotErr}
              </p>
            )}
            {forgotMsg && (
              <p className="text-xs text-teal-700 bg-teal-50 px-2 py-1 rounded font-medium">
                {forgotMsg}
              </p>
            )}
            <button
              type="button"
              disabled={forgotBusy || !otp.trim() || !newPass}
              onClick={() => void submitReset()}
              className="w-full py-2.5 text-sm font-semibold rounded-lg bg-sky-600 text-white disabled:opacity-50"
            >
              {forgotBusy ? "Đang xử lý…" : "ĐỔI MẬT KHẨU"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
