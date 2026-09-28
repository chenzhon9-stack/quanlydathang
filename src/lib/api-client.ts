/** Client helpers gọi API /api/v1 (Bearer token từ localStorage) */

export async function apiPost(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } }> {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

export async function apiPatch(
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } }> {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}
