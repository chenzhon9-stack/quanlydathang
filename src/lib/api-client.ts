/** Client helpers gọi API /api/v1 (Bearer token từ localStorage) */

function authHeaders(): HeadersInit {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Session bị revoke / hết hạn → xóa token, về login */
function handleAuthFailure(res: Response, json: { error?: { code?: string; message?: string } }) {
  if (res.status !== 401) return;
  const code = String(json?.error?.code || "");
  if (
    code === "SESSION_REVOKED" ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID"
  ) {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
      window.location.href = "/login";
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
