import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { FinanceService } from "@/services/finance.service";
import { success, error, jsonResponse } from "@/lib/api";

/** POST /api/v1/finance/prices/adjust — điều chỉnh hàng loạt giá NCC */
export async function POST(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    // Chuẩn hóa maHH/makv ngay tại route — luôn string[]
    const toStrList = (v: unknown): string[] => {
      if (Array.isArray(v)) {
        return v.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
      if (typeof v === "string" && v.trim()) {
        return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      }
      return [];
    };
    const maHH = toStrList(body.maHH);
    const makv = toStrList(body.makv);
    console.info("[prices/adjust]", {
      maNCC: body.maNCC,
      maHHCount: maHH.length,
      maHH,
      makvCount: makv.length,
    });
    const result = await FinanceService.adjustGiaMuaTheoNCC(
      {
        maNCC: String(body.maNCC || ""),
        tuNgayMoi: String(body.tuNgayMoi || ""),
        maHH,
        makv,
        mode: body.mode as "amount" | "percent" | undefined,
        direction: body.direction as "increase" | "decrease" | undefined,
        value: Number(body.value),
      },
      user
    );
    return jsonResponse(success(result));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi hệ thống"), 500);
  }
}
