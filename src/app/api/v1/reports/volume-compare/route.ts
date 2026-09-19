import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { getMockVolumeCompare, type VolumeMode, type VolumeMetric } from "@/mocks/volume";

export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "ytd") as VolumeMode;
    const metric = (searchParams.get("metric") || "receiving") as VolumeMetric;
    const year = searchParams.get("year")
      ? Number(searchParams.get("year"))
      : 2026;

    if (mode !== "ytd" && mode !== "mom") {
      return jsonResponse(error("VALIDATION_ERROR", "mode phải là ytd|mom"), 400);
    }
    if (metric !== "receiving" && metric !== "delivery") {
      return jsonResponse(
        error("VALIDATION_ERROR", "metric phải là receiving|delivery"),
        400
      );
    }

    // Phase 1: mock. Sau này aggregate từ ReportRepository + PhanLoaiHH
    const data = getMockVolumeCompare(mode, metric, year);
    return jsonResponse(
      success(data, { source: "mock", generatedAt: new Date().toISOString() })
    );
  } catch (e) {
    console.error(e);
    return jsonResponse(error("INTERNAL_ERROR", "Lỗi hệ thống"), 500);
  }
}
