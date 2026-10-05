"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type UserRow = {
  email: string;
  hoTen: string;
  role: string;
  /** V21.07 multi-role từ UserRoles */
  roles?: string[];
  quanly: string;
  active: boolean;
  trangThai?: string;
  phongBan?: string;
  dienThoai?: string;
  lastLogin?: string;
};

type Tab = "users" | "roles" | "permissions" | "matrix" | "userRoles";

const ROLE_OPTIONS: { code: string; label: string }[] = [
  { code: "ADMIN", label: "Quản trị" },
  { code: "MANAGER", label: "Quản lý" },
  { code: "PURCHASE", label: "Thu mua" },
  { code: "DISPATCHER", label: "Điều phối" },
  { code: "ACCOUNTANT", label: "Kế toán" },
  { code: "CUSTOMER_ACCOUNTANT", label: "KT khách hàng" },
  { code: "SALES", label: "Kinh doanh" },
  { code: "VIEWER", label: "Chỉ xem" },
];

export default function AdminUsersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [rbac, setRbac] = useState<{
    roles: Record<string, string>[];
    permissions: Record<string, string>[];
    rolePermissions: Record<string, string>[];
    userRoles: Record<string, string>[];
    matrix: Record<string, string[]>;
    source: string;
  } | null>(null);

  // edit modal
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [form, setForm] = useState({
    roles: [] as string[],
    quanly: "",
    hoTen: "",
    active: true,
    trangThai: "Approved",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);

  const token = () => localStorage.getItem("token") || "";

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/v1/users", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await res.json();
      if (!json.success) {
        if (res.status === 403) {
          router.replace("/dashboard");
          return;
        }
        setErr(json.error?.message || "Lỗi tải user");
        return;
      }
      setUsers(json.data.items || []);
      setSource(json.data.source || "");
    } catch {
      setErr("Không kết nối API");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadRbac = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/rbac?section=all", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const json = await res.json();
      if (json.success) setRbac(json.data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem("user") || "{}");
    if (String(u.role || "").toUpperCase() !== "ADMIN") {
      router.replace("/dashboard");
      return;
    }
    loadUsers();
    loadRbac();
  }, [loadUsers, loadRbac, router]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(s) ||
        (u.hoTen || "").toLowerCase().includes(s) ||
        (u.role || "").toLowerCase().includes(s) ||
        (u.quanly || "").toLowerCase().includes(s)
    );
  }, [users, q]);

  function openEdit(u: UserRow) {
    setEdit(u);
    const roles =
      u.roles && u.roles.length
        ? u.roles.map((r) => String(r).toUpperCase())
        : u.role
          ? [String(u.role).toUpperCase()]
          : [];
    setForm({
      roles,
      quanly: u.quanly || "",
      hoTen: u.hoTen || "",
      active: u.active,
      trangThai: u.trangThai || (u.active ? "Approved" : "Locked"),
    });
    setMsg("");
    setMsgOk(false);
  }

  function toggleRole(code: string) {
    setForm((f) => {
      const c = code.toUpperCase();
      const has = f.roles.includes(c);
      if (has) {
        // Không cho bỏ hết role
        if (f.roles.length <= 1) return f;
        return { ...f, roles: f.roles.filter((r) => r !== c) };
      }
      return { ...f, roles: [...f.roles, c] };
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setSaving(true);
    setMsg("");
    setMsgOk(false);

    try {
      if (!form.roles.length) {
        setMsg("Chọn ít nhất 1 role");
        setSaving(false);
        return;
      }
      const body: Record<string, unknown> = {
        roles: form.roles,
        quanly: form.quanly,
        hoTen: form.hoTen,
        active: form.active,
        trangThai: form.trangThai,
      };

      const res = await fetch(
        `/api/v1/users/${encodeURIComponent(edit.email)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const json = await res.json();
      if (!json.success) {
        setMsg(json.error?.message || "Lỗi lưu");
        return;
      }
      const revoked = Boolean(json.data?.sessionsRevoked);
      setMsgOk(true);
      setMsg(
        revoked
          ? "Đã lưu — phiên đăng nhập cũ của user đã bị thu hồi (khóa tài khoản)."
          : "Đã lưu"
      );
      setEdit(null);
      await loadUsers();
      await loadRbac();
    } catch {
      setMsg("Lỗi kết nối");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Tài khoản" },
    { id: "roles", label: "Roles" },
    { id: "permissions", label: "Permissions" },
    { id: "matrix", label: "Role × Permission" },
    { id: "userRoles", label: "UserRoles" },
  ];

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Quản trị User & Quyền</h2>
          <p className="text-xs text-slate-500">
            Admin only · nguồn user: {source || "—"}
            {rbac?.source ? ` · RBAC: ${rbac.source}` : ""}
          </p>
        </div>
        <button
          onClick={() => {
            loadUsers();
            loadRbac();
          }}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-white border border-slate-200"
        >
          Tải lại
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              tab === t.id
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      {/* USERS */}
      {tab === "users" && (
        <>
          <div className="flex gap-2 items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm email, tên, role, quanly…"
              className="flex-1 max-w-md px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <span className="text-xs text-slate-400">{filtered.length} user</span>
          </div>

          {loading ? (
            <div className="text-sm text-slate-400 py-8 text-center">Đang tải…</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 text-xs">
                    <th className="px-3 py-2.5 text-left font-semibold">Email</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Họ tên</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Role</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Quản lý</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Trạng thái</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Active</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.email} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-blue-700 text-xs">{u.email}</td>
                      <td className="px-3 py-2 font-medium">{u.hoTen}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {(u.roles && u.roles.length ? u.roles : [u.role])
                            .filter(Boolean)
                            .map((r) => (
                              <span
                                key={r}
                                className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700"
                              >
                                {ROLE_OPTIONS.find((o) => o.code === String(r).toUpperCase())
                                  ?.label || r}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 text-xs max-w-[140px] truncate" title={u.quanly}>
                        {u.quanly || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{u.trangThai || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-xs font-medium ${
                            u.active ? "text-emerald-600" : "text-red-500"
                          }`}
                        >
                          {u.active ? "ON" : "OFF"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100"
                        >
                          Sửa
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-slate-400">
                        Không có user
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ROLES */}
      {tab === "roles" && (
        <SimpleTable
          rows={rbac?.roles || []}
          cols={[
            ["RoleCode", "Mã"],
            ["TenRole", "Tên"],
            ["HoatDong", "Active"],
            ["GhiChu", "Ghi chú"],
          ]}
          empty="Chưa seed Roles — chạy seedAllRBAC() trên GAS"
        />
      )}

      {/* PERMISSIONS */}
      {tab === "permissions" && (
        <SimpleTable
          rows={rbac?.permissions || []}
          cols={[
            ["PermCode", "Mã quyền"],
            ["Nhom", "Nhóm"],
            ["MoTa", "Mô tả"],
            ["HoatDong", "Active"],
          ]}
          empty="Chưa seed Permissions"
        />
      )}

      {/* MATRIX */}
      {tab === "matrix" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-slate-100">
                  Role
                </th>
                <th className="px-3 py-2 text-left font-semibold">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rbac?.matrix || {}).map(([role, perms]) => (
                <tr key={role} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold sticky left-0 bg-white">
                    {role}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(perms as string[]).map((p) => (
                        <span
                          key={p}
                          className="inline-flex px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-100"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!Object.keys(rbac?.matrix || {}).length && (
            <div className="text-center py-8 text-slate-400 text-sm">
              Chưa có matrix
            </div>
          )}
        </div>
      )}

      {/* USER ROLES */}
      {tab === "userRoles" && (
        <SimpleTable
          rows={rbac?.userRoles || []}
          cols={[
            ["Email", "Email"],
            ["RoleCode", "Role"],
            ["HoatDong", "Active"],
            ["Source", "Nguồn"],
            ["UpdatedAt", "Cập nhật"],
            ["UpdatedBy", "Bởi"],
          ]}
          empty="UserRoles trống — chạy rbacMigrationApply() hoặc gán Role khi Sửa user"
        />
      )}

      {/* EDIT MODAL */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Sửa tài khoản</h3>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-blue-700 font-mono">{edit.email}</p>

            <label className="block text-xs font-semibold text-slate-600">
              Họ tên
              <input
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={form.hoTen}
                onChange={(e) => setForm((f) => ({ ...f, hoTen: e.target.value }))}
              />
            </label>

            <div className="block text-xs font-semibold text-slate-600">
              Role (multi — V21.07 UserRoles)
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {ROLE_OPTIONS.map((r) => {
                  const checked = form.roles.includes(r.code);
                  return (
                    <label
                      key={r.code}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs font-normal cursor-pointer ${
                        checked
                          ? "border-blue-400 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole(r.code)}
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-slate-400 font-normal">
                Role mạnh nhất (User.Role cache):{" "}
                <b>
                  {form.roles.includes("ADMIN")
                    ? "ADMIN"
                    : form.roles.includes("MANAGER")
                      ? "MANAGER"
                      : form.roles.includes("PURCHASE")
                        ? "PURCHASE"
                        : form.roles[0] || "—"}
                </b>
              </p>
            </div>

            <label className="block text-xs font-semibold text-slate-600">
              Quản lý (nhóm, tách ;)
              <input
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={form.quanly}
                onChange={(e) => setForm((f) => ({ ...f, quanly: e.target.value }))}
                placeholder="vd: Miền Bắc;Miền Trung hoặc tất cả"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-600">
              Trạng thái
              <select
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={form.trangThai}
                onChange={(e) =>
                  setForm((f) => ({ ...f, trangThai: e.target.value }))
                }
              >
                {["Approved", "Pending", "Locked", "Rejected"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((f) => ({ ...f, active: e.target.checked }))
                }
              />
              Hoạt động (HoatDong)
            </label>

            {/* V21: mật khẩu do user tự xử lý qua Quên/Đổi mật khẩu + OTP */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Mật khẩu</p>
              <p className="text-[11px] text-slate-500 leading-snug mt-1">
                Admin không đặt hộ mật khẩu. User tự đổi trên màn hình đăng
                nhập → <b>Quên/Đổi mật khẩu</b> (OTP gửi email, hiệu lực 15 phút).
              </p>
            </div>

            {msg && (
              <div
                className={`text-xs rounded px-2 py-1 ${
                  msgOk
                    ? "text-emerald-700 bg-emerald-50"
                    : "text-red-600 bg-red-50"
                }`}
              >
                {msg}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-200"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveEdit}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleTable({
  rows,
  cols,
  empty,
}: {
  rows: Record<string, string>[];
  cols: [string, string][];
  empty: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-slate-100 text-slate-600 text-xs">
            {cols.map(([k, label]) => (
              <th key={k} className="px-3 py-2.5 text-left font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map(([k]) => (
                <td key={k} className="px-3 py-2 whitespace-nowrap text-slate-700">
                  {String(r[k] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="text-center py-8 text-slate-400 text-sm">{empty}</div>
      )}
    </div>
  );
}
