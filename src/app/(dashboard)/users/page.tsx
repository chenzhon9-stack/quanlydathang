"use client";

import { useEffect, useState } from "react";

type Row = {
  email: string;
  hoTen: string;
  role: string;
  quanly: string;
  active: boolean;
};

export default function UsersPage() {
  const [users, setUsers] = useState<Row[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  function load() {
    const token = localStorage.getItem("token");
    if (!token) return;
    setLoading(true);
    fetch("/api/v1/users", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) {
          setErr(json.error?.message || "Lỗi tải user");
          return;
        }
        setUsers(json.data.items || []);
        setSource(json.data.source || "");
        setErr("");
      })
      .catch(() => setErr("Không kết nối API"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Tài khoản</h2>
          <p className="text-xs text-slate-500">
            Quản trị người dùng · Admin only
            {source ? ` · nguồn: ${source}` : ""}
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Đang tải...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase">
                <th className="px-3 py-2.5 text-left font-semibold">Email</th>
                <th className="px-3 py-2.5 text-left font-semibold">Họ tên</th>
                <th className="px-3 py-2.5 text-left font-semibold">Role</th>
                <th className="px-3 py-2.5 text-left font-semibold">Quản lý</th>
                <th className="px-3 py-2.5 text-left font-semibold">TT</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 text-blue-700">{u.email}</td>
                  <td className="px-3 py-2.5 font-medium">{u.hoTen}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{u.quanly || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-xs font-medium ${
                        u.active ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {u.active ? "Active" : "Khóa"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Không có user (sheet User trống hoặc chưa map)
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-slate-400">
        Login thật: email + Password trên sheet User (plain hoặc SHA-256/MD5). Mock
        vẫn dùng khi email không có trên sheet.
      </p>
    </div>
  );
}
