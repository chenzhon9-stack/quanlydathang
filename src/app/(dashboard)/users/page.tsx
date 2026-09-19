"use client";

import { useEffect, useState } from "react";

/**
 * Tab Tài khoản — chỉ ADMIN (Permission Matrix)
 * Actions: Tải lại, Duyệt/Lưu, Từ chối, Khóa/Mở khóa
 */
const MOCK_USERS_ADMIN = [
  {
    email: "admin@viethai.local",
    hoTen: "Quản trị viên",
    role: "ADMIN",
    status: "Active",
    quanly: "ALL",
  },
  {
    email: "purchase@viethai.local",
    hoTen: "Nhân viên mua hàng",
    role: "PURCHASE",
    status: "Active",
    quanly: "A",
  },
  {
    email: "manager@viethai.local",
    hoTen: "Quản lý",
    role: "MANAGER",
    status: "Active",
    quanly: "A",
  },
  {
    email: "dispatcher@viethai.local",
    hoTen: "Điều phối",
    role: "DISPATCHER",
    status: "Pending",
    quanly: "",
  },
  {
    email: "trungth2009@gmail.com",
    hoTen: "Trung Trần",
    role: "PURCHASE",
    status: "Active",
    quanly: "A",
  },
];

export default function UsersPage() {
  const [users, setUsers] = useState(MOCK_USERS_ADMIN);
  const [role, setRole] = useState("");

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      setRole((u.role || "").toUpperCase());
    } catch {
      setRole("");
    }
  }, []);

  if (role && role !== "ADMIN") {
    return (
      <div className="text-center py-16 text-slate-500">
        <p className="font-medium">Không có quyền truy cập</p>
        <p className="text-xs mt-1">Tab Tài khoản chỉ dành cho ADMIN</p>
      </div>
    );
  }

  function toast(msg: string) {
    alert(`[Mock] ${msg}`);
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Tài khoản</h2>
          <p className="text-xs text-slate-500">Quản trị người dùng · Admin only</p>
        </div>
        <button
          onClick={() => toast("Tải lại — loadUsersAdmin()")}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left font-semibold">Email</th>
                <th className="px-3 py-2.5 text-left font-semibold">Họ tên</th>
                <th className="px-3 py-2.5 text-left font-semibold">Role</th>
                <th className="px-3 py-2.5 text-left font-semibold">Quản lý</th>
                <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-xs font-mono text-blue-700">
                    {u.email}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{u.hoTen}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{u.quanly || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        u.status === "Active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : u.status === "Pending"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-red-50 text-red-700 border-red-200"
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1 justify-end">
                      <button
                        onClick={() => toast(`Duyệt/Lưu ${u.email}`)}
                        className="px-2 py-1 text-[11px] font-medium rounded bg-blue-600 text-white"
                      >
                        Duyệt/Lưu
                      </button>
                      {u.status === "Pending" && (
                        <button
                          onClick={() => toast(`Từ chối ${u.email}`)}
                          className="px-2 py-1 text-[11px] font-medium rounded bg-red-500 text-white"
                        >
                          Từ chối
                        </button>
                      )}
                      <button
                        onClick={() =>
                          toast(
                            u.status === "Active"
                              ? `Khóa ${u.email}`
                              : `Mở khóa ${u.email}`
                          )
                        }
                        className="px-2 py-1 text-[11px] font-medium rounded bg-slate-600 text-white"
                      >
                        {u.status === "Active" ? "Khóa" : "Mở khóa"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Khối Master / Giá mua / Bảo trì hệ thống sẽ bổ sung ở phase Admin sau.
      </p>
    </div>
  );
}
