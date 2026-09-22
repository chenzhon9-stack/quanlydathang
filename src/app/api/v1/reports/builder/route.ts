import { NextRequest } from "next/server";
import { getCurrentUser, resolveScope } from "@/lib/auth";
import { success, error, jsonResponse } from "@/lib/api";
import { ReportBuilderService } from "@/services/report-builder.service";
import type { ReportType } from "@/lib/reports/dynamic-group";
import { REPORT_SCHEMAS } from "@/lib/reports/dynamic-group";

const TYPES = Object.keys(REPORT_SCHEMAS) as ReportType[];

/** GET /api/v1/reports/builder?type=thuc_nhan&fromDate=&toDate=&groupBy=ncc,hangHoa */
export async function GET(req: NextRequest) {
  try {
    const token =
      req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const user = getCurrentUser(token);
    if (!user)
      return jsonResponse(error("AUTH_REQUIRED", "Chưa đăng nhập"), 401);

    const sp = req.nextUrl.searchParams;
    const type = (sp.get("type") || "thuc_nhan") as ReportType;
    if (!TYPES.includes(type)) {
      return jsonResponse(
        error("VALIDATION_ERROR", `type: ${TYPES.join("|")}`),
        400
      );
    }

    const groupByRaw = sp.get("groupBy") || "";
    const groupBy = groupByRaw
      ? groupByRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const filters: ReportBuilderParamsFilters = {};
    const ncc = sp.get("ncc");
    if (ncc) filters.ncc = ncc.split(",");
    const hangHoa = sp.get("hangHoa");
    if (hangHoa) filters.hangHoa = hangHoa.split(",");
    const phanLoai = sp.get("phanLoai");
    if (phanLoai) filters.phanLoai = phanLoai.split(",");

    const scope = resolveScope(user);
    const result = await ReportBuilderService.run(
      type,
      {
        fromDate: sp.get("fromDate") || undefined,
        toDate: sp.get("toDate") || undefined,
        year: sp.get("year") ? Number(sp.get("year")) : undefined,
        groupBy,
        sortBy: sp.get("sortBy") || undefined,
        sortOrder: (sp.get("sortOrder") as "asc" | "desc") || undefined,
        filters: Object.keys(filters).length ? filters : undefined,
        page: sp.get("page") ? Number(sp.get("page")) : 1,
        pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 100,
      },
      user,
      scope
    );

    return jsonResponse(success(result, result.meta));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "PERMISSION_DENIED")
      return jsonResponse(error(err.code, err.message || ""), 403);
    if (err?.code)
      return jsonResponse(error(err.code, err.message || ""), 400);
    console.error(e);
    return jsonResponse(error("SYSTEM_UNEXPECTED_ERROR", "Lỗi báo cáo"), 500);
  }
}

type ReportBuilderParamsFilters = {
  ncc?: string[];
  hangHoa?: string[];
  phanLoai?: string[];
};
