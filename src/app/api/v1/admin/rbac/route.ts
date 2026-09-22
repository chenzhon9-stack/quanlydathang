import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

function requireAdmin(token: string | null) {
  const user = getCurrentUser(token);
  if (!user) return { error: jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401) };
  if (user.role !== "ADMIN" && !user.permissions.includes("*")) {
    return { error: jsonResponse(error("PERMISSION_DENIED", "Chỉ ADMIN"), 403) };
  }
  return { user };
}

/** GET /api/v1/admin/rbac?section=roles|permissions|rolePermissions|userRoles|matrix */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const gate = requireAdmin(token);
    if (gate.error) return gate.error;

    const section = req.nextUrl.searchParams.get("section") || "all";

    if (!isSheetsConfigured()) {
      // code matrix fallback
      if (section === "matrix" || section === "all") {
        return jsonResponse(
          success({
            matrix: ROLE_PERMISSIONS,
            roles: Object.keys(ROLE_PERMISSIONS),
            source: "code-matrix",
          })
        );
      }
      return jsonResponse(success({ items: [], source: "none" }));
    }

    const load = async (name: string) => {
      try {
        return await readSheetAsObjects(name, {});
      } catch {
        return [];
      }
    };

    if (section === "roles") {
      const items = await load(SHEETS.ROLES);
      return jsonResponse(success({ items, source: "sheet" }));
    }
    if (section === "permissions") {
      const items = await load(SHEETS.PERMISSIONS);
      return jsonResponse(success({ items, source: "sheet" }));
    }
    if (section === "rolePermissions") {
      const items = await load(SHEETS.ROLE_PERMISSIONS);
      return jsonResponse(success({ items, source: "sheet" }));
    }
    if (section === "userRoles") {
      const items = await load(SHEETS.USER_ROLES);
      return jsonResponse(success({ items, source: "sheet" }));
    }

    // all / matrix
    const [roles, permissions, rolePermissions, userRoles] = await Promise.all([
      load(SHEETS.ROLES),
      load(SHEETS.PERMISSIONS),
      load(SHEETS.ROLE_PERMISSIONS),
      load(SHEETS.USER_ROLES),
    ]);

    // Build matrix view from sheet or code
    const matrix: Record<string, string[]> = {};
    if (rolePermissions.length) {
      for (const r of rolePermissions) {
        const active = String(r.HoatDong ?? "true").toLowerCase();
        if (active === "false" || active === "0") continue;
        const rc = String(r.RoleCode || "").trim().toUpperCase();
        const pc = String(r.PermCode || "").trim();
        if (!rc || !pc) continue;
        if (!matrix[rc]) matrix[rc] = [];
        if (!matrix[rc].includes(pc)) matrix[rc].push(pc);
      }
    } else {
      Object.assign(matrix, ROLE_PERMISSIONS);
    }

    return jsonResponse(
      success({
        roles,
        permissions,
        rolePermissions,
        userRoles,
        matrix,
        source: rolePermissions.length ? "sheet" : "code-matrix",
      })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi RBAC"), 500);
  }
}
