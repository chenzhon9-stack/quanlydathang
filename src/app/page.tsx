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
      // Mật khẩu: trình duyệt lưu qua autocomplete (không lưu trong app)
      const u = (json.data.user || {}) as ClientUser;
      router.push(firstAllowedPath(u));
    } catch {
      setError("Không kết nối được máy chủ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-2xl font-bold mx-auto mb-3">
            VH
          </div>
          <h1 className="text-xl font-bold text-slate-800">
            Quản lý Đặt hàng
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Viết Hải – Hệ thống vận tải
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-4"
          autoComplete="on"
          method="post"
        >
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Email
            </label>
            <input
              id="login-email"
              name="username"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Mật khẩu
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
              className="rounded border-slate-300"
            />
            Ghi nhớ email trên thiết bị này
          </label>

          {error && (
            <div className="text-red-600 text-xs bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition disabled:opacity-50"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}
