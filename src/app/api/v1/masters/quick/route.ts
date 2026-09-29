import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MasterQuickService } from "@/services/master-quick.service";
import { success, error, jsonResponse } from "@/lib/api";

/** POST /api/v1/masters/quick — thêm nhanh ĐVT | XE (V21 quickAdd*) */
export async function POST(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "").toUpperCase();

    if (type === "DVT") {
      const result = await MasterQuickService.quickAddDvt(body, user);
      return jsonResponse(success(result));
    }
    if (type === "XE") {
      const result = await MasterQuickService.quickAddVehicle(body, user);
      return jsonResponse(success(result));
    }
    return jsonResponse(
      error("VALIDATION_ERROR", "type phải là DVT hoặc XE"),
      400
    );
  } catch (e: unknown) {
    const err = e as {
      code?: string;
      message?: string;
      item?: unknown;
    };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code === "DUPLICATE") {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "DUPLICATE",
            message: err.message || "Trùng",
            item: err.item,
          },
        },
        409
      );
    }
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
