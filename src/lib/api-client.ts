/** Client helpers gọi API /api/v1 (Bearer token từ localStorage) */

function authHeaders(): HeadersInit {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const REMEMBER_EMAIL_KEY = "vh_login_email";

/** Lưu email trước khi xóa session — trang login điền sẵn */
function preserveLoginEmail() {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const u = JSON.parse(raw) as { email?: string };
      const em = String(u?.email || "").trim();
      if (em) localStorage.setItem(REMEMBER_EMAIL_KEY, em);
    }
  } catch {
    /* ignore */
  }
}

/** Session bị revoke / hết hạn → xóa token, về trang login (/) kèm email đã nhớ */
function handleAuthFailure(res: Response, json: { error?: { code?: string; message?: string } }) {
  if (res.status !== 401) return;
  const code = String(json?.error?.code || "");
  if (
    code === "SESSION_REVOKED" ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID" ||
    code === "TOKEN_EXPIRED"
  ) {
    try {
      preserveLoginEmail();
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      sessionStorage.setItem("vh_session_expired", "1");
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") {
      const path = window.location.pathname || "/";
      // Trang login là "/" — không redirect vòng
      if (path !== "/" && path !== "") {
        window.location.href = "/?expired=1";
      }
    }
  }
}

export async function apiPost(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string; code?: string } }> {
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  handleAuthFailure(res, json);
  return json;
}

export async function apiPatch(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string; code?: string } }> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  handleAuthFailure(res, json);
  return json;
}

export async function apiGet(
  path: string
): Promise<{ success: boolean; data?: unknown; error?: { message?: string; code?: string } }> {
  const res = await fetch(path, {
    method: "GET",
    headers: authHeaders(),
  });
  const json = await res.json();
  handleAuthFailure(res, json);
  return json;
}
