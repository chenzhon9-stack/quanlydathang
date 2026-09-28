import type { AccessScope, ProductionPlan, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { ReportRepository } from "@/repositories/report.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { SHEETS } from "@/lib/sheets/constants";
import {
  appendSheetRow,
  updateSheetRowByKey,
  readSheetAsObjects,
} from "@/lib/sheets/dal";
import { nextCounterCodes } from "@/lib/sheets/counter";
import {
  formatDateTimeVN,
  ymdDate,
  currentYearVN,
} from "@/lib/sheets/date";
import { isExcludedDetailStatus } from "@/lib/reports/exclude-detail";
import { writeAudit } from "@/lib/sheets/audit";

export type PlanInput = {
  programName: string;
  supplierId: string;
  productIds: string[];
  fromDate: string;
  toDate: string;
  plannedQuantity: number;
  status?: string;
  note?: string;
  year?: number;
};

function requirePlanView(user: UserContext) {
  if (
    !hasPermission(user, "PLAN_VIEW") &&
    !hasPermission(user, "KHSL_VIEW") &&
    !hasPermission(user, "REPORT_VIEW") &&
    !hasPermission(user, "*")
  ) {
    throw {
      code: "PERMISSION_DENIED",
      message: "Không có quyền xem kế hoạch sản lượng",
    };
  }
}

function requirePlanUpdate(user: UserContext) {
  if (
    !hasPermission(user, "PLAN_UPDATE") &&
    !hasPermission(user, "KHSL_UPDATE") &&
    !hasPermission(user, "*")
  ) {
    throw {
      code: "PERMISSION_DENIED",
      message: "Không có quyền sửa kế hoạch sản lượng",
    };
  }
}

/** Thực nhận trong kỳ KH: cùng NCC + HH ∈ danh sách + NgayNhan trong [from,to] */
async function computeActualForPlan(
  plan: ProductionPlan,
  year: number
): Promise<number> {
  try {
    const details = await ReportRepository.getDetails(year);
    const from = (plan.fromDate || "").slice(0, 10);
    const to = (plan.toDate || "").slice(0, 10);
    const hhSet = new Set(
      (plan.productIds || []).map((x) => String(x).trim().toUpperCase())
    );
    const ncc = String(plan.supplierId || "").trim().toUpperCase();
    let sum = 0;
    for (const d of details) {
      if (isExcludedDetailStatus(String(d.status || ""))) continue;
      if (String(d.supplierId || "").trim().toUpperCase() !== ncc) continue;
      if (hhSet.size && !hhSet.has(String(d.productId || "").trim().toUpperCase()))
        continue;
      const nd = String(d.receivedDate || "").slice(0, 10);
      if (!nd) continue;
      if (from && nd < from) continue;
      if (to && nd > to) continue;
      const tn = Number(d.actualReceived) || 0;
      if (tn > 0) sum += tn;
    }
    return Math.round(sum * 1000) / 1000;
  } catch (e) {
    console.error("[PlanningService] computeActual", e);
    return Number(plan.actualQuantity) || 0;
  }
}

export class PlanningService {
  static async listPlans(
    filter: {
      year?: number;
      supplierId?: string;
      status?: string;
      q?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      pageSize?: number;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    requirePlanView(user);

    const year = filter.year ?? currentYearVN();
    let plans = await ReportRepository.getPlans(year);
    plans = plans.sort((a, b) => {
      const d = (b.fromDate || "").localeCompare(a.fromDate || "");
      if (d !== 0) return d;
      return (b.id || "").localeCompare(a.id || "");
    });

    if (filter.supplierId) {
      plans = plans.filter((p) => p.supplierId === filter.supplierId);
    }
    if (filter.status && filter.status !== "ALL") {
      const st = filter.status.toLowerCase();
      plans = plans.filter((p) =>
        String(p.status || "").toLowerCase().includes(st)
      );
    }
    if (filter.fromDate) {
      const f = filter.fromDate.slice(0, 10);
      plans = plans.filter((p) => !p.toDate || p.toDate.slice(0, 10) >= f);
    }
    if (filter.toDate) {
      const t = filter.toDate.slice(0, 10);
      plans = plans.filter((p) => !p.fromDate || p.fromDate.slice(0, 10) <= t);
    }
    if (filter.q?.trim()) {
      const q = filter.q.trim().toLowerCase();
      plans = plans.filter((p) => {
        const hay = [
          p.id,
          p.programName,
          p.supplierId,
          p.supplierName,
          ...(p.productIds || []),
          p.note,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      plans = filterBySupplierIds(plans, allowed);
    }

    const nccMap = await MasterRepository.nccNames();
    const hhMap = await MasterRepository.hhNames();

    // Enrich actual + names (giới hạn 80 plan/trang để tránh timeout)
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = plans.length;
    const start = (page - 1) * pageSize;
    const slice = plans.slice(start, start + pageSize);

    const items: ProductionPlan[] = [];
    for (const p of slice) {
      const actual = await computeActualForPlan(p, year);
      const productNames = (p.productIds || []).map(
        (id) => hhMap[id] || id
      );
      items.push({
        ...p,
        supplierName: p.supplierName || nccMap[p.supplierId] || p.supplierId,
        actualQuantity: actual,
        productNames,
      } as ProductionPlan & { productNames: string[] });
    }

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }

  static async getPlan(
    id: string,
    user: UserContext,
    scope: AccessScope,
    year?: number
  ) {
    requirePlanView(user);
    const y = year ?? currentYearVN();
    const plans = await ReportRepository.getPlans(y);
    let p = plans.find(
      (x) => String(x.id).toUpperCase() === String(id).trim().toUpperCase()
    );
    if (!p) throw { code: "NOT_FOUND", message: "Không tìm thấy kế hoạch" };

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      if (allowed && !allowed.has(p.supplierId)) {
        throw { code: "PERMISSION_DENIED", message: "Ngoài phạm vi quản lý" };
      }
    }

    const nccMap = await MasterRepository.nccNames();
    const hhMap = await MasterRepository.hhNames();
    const actual = await computeActualForPlan(p, y);
    return {
      ...p,
      supplierName: p.supplierName || nccMap[p.supplierId] || p.supplierId,
      actualQuantity: actual,
      productNames: (p.productIds || []).map((id) => hhMap[id] || id),
    };
  }

  static async createPlan(input: PlanInput, user: UserContext) {
    requirePlanUpdate(user);
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
    }

    const programName = String(input.programName || "").trim();
    const supplierId = String(input.supplierId || "").trim();
    const productIds = (input.productIds || [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    const fromDate = ymdDate(input.fromDate) || "";
    const toDate = ymdDate(input.toDate) || "";
    const planned = Number(input.plannedQuantity) || 0;

    if (!programName) throw { code: "VALIDATION_ERROR", message: "Thiếu tên chương trình" };
    if (!supplierId) throw { code: "VALIDATION_ERROR", message: "Thiếu nhà cung cấp" };
    if (!productIds.length)
      throw { code: "VALIDATION_ERROR", message: "Chọn ít nhất 1 hàng hóa" };
    if (!fromDate || !toDate)
      throw { code: "VALIDATION_ERROR", message: "Thiếu từ ngày / đến ngày" };
    if (toDate < fromDate)
      throw { code: "VALIDATION_ERROR", message: "Đến ngày phải ≥ từ ngày" };
    if (planned <= 0)
      throw { code: "VALIDATION_ERROR", message: "Sản lượng kế hoạch phải > 0" };

    const y = input.year ?? currentYearVN();
    const codes = await nextCounterCodes("KH", fromDate, {
      count: 1,
      email: user.email,
      year: y,
    });
    const id = codes[0]; // KH-yyMMdd-####
    const now = formatDateTimeVN();
    const status = String(input.status || "Đang thực hiện").trim() || "Đang thực hiện";

    await appendSheetRow(
      SHEETS.KHSL,
      {
        ID_KeHoach: id,
        Tenchuongtrinh: programName,
        MaNCC: supplierId,
        DanhSachHH: productIds.join(","),
        TuNgay: fromDate,
        DenNgay: toDate,
        SoLuongKeHoach: planned,
        ThucTe: 0,
        TrangThai: status,
        GhiChu: input.note || "",
        NguoiTao: user.email,
        NgayTao: now,
        NgayCapNhat: now,
      },
      y
    );

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PLAN_CREATE",
      maDon: id,
      targetId: id,
      newValue: JSON.stringify({ supplierId, planned, fromDate, toDate }),
      year: y,
    }).catch(() => null);

    return { id, programName, supplierId, productIds, fromDate, toDate, plannedQuantity: planned, status };
  }

  static async updatePlan(
    id: string,
    input: Partial<PlanInput>,
    user: UserContext,
    year?: number
  ) {
    requirePlanUpdate(user);
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
    }
    const y = year ?? currentYearVN();
    const existing = await ReportRepository.getPlans(y);
    const found = existing.find(
      (x) => String(x.id).toUpperCase() === String(id).trim().toUpperCase()
    );
    if (!found) throw { code: "NOT_FOUND", message: "Không tìm thấy kế hoạch" };
    if (String(found.status || "").includes("Hủy")) {
      throw { code: "INVALID_STATE", message: "Kế hoạch đã hủy, không sửa được" };
    }

    const patch: Record<string, string | number> = {
      NgayCapNhat: formatDateTimeVN(),
    };
    if (input.programName != null)
      patch.Tenchuongtrinh = String(input.programName).trim();
    if (input.supplierId != null) patch.MaNCC = String(input.supplierId).trim();
    if (input.productIds != null)
      patch.DanhSachHH = input.productIds.map(String).filter(Boolean).join(",");
    if (input.fromDate != null) patch.TuNgay = ymdDate(input.fromDate) || "";
    if (input.toDate != null) patch.DenNgay = ymdDate(input.toDate) || "";
    if (input.plannedQuantity != null)
      patch.SoLuongKeHoach = Number(input.plannedQuantity) || 0;
    if (input.status != null) patch.TrangThai = String(input.status).trim();
    if (input.note != null) patch.GhiChu = String(input.note);

    await updateSheetRowByKey(SHEETS.KHSL, "ID_KeHoach", id, patch, y);

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PLAN_UPDATE",
      maDon: id,
      targetId: id,
      newValue: JSON.stringify(patch),
      year: y,
    }).catch(() => null);

    return { id, ok: true };
  }

  static async cancelPlan(id: string, user: UserContext, year?: number) {
    requirePlanUpdate(user);
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
    }
    const y = year ?? currentYearVN();
    await updateSheetRowByKey(
      SHEETS.KHSL,
      "ID_KeHoach",
      id,
      {
        TrangThai: "Hủy",
        NgayCapNhat: formatDateTimeVN(),
      },
      y
    );
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PLAN_CANCEL",
      maDon: id,
      targetId: id,
      year: y,
    }).catch(() => null);
    return { id, status: "Hủy" };
  }

  /** HH thuộc NCC (NCC_Hanghoa) — fallback all HH nếu sheet trống */
  static async productsForSupplier(supplierId: string): Promise<
    Array<{ id: string; name: string }>
  > {
    const hhMap = await MasterRepository.hhNames();
    if (!isSheetsConfigured()) {
      return Object.entries(hhMap).map(([id, name]) => ({ id, name }));
    }
    try {
      const links = await readSheetAsObjects(SHEETS.NCC_HH, {});
      const ids = new Set<string>();
      for (const r of links) {
        const ncc = String(r.MaNCC || "").trim();
        if (ncc !== supplierId) continue;
        const active = String(r.HoatDong ?? "true").toLowerCase();
        if (["false", "0", "no", "không"].includes(active)) continue;
        const hh = String(r.MaHH || "").trim();
        if (hh) ids.add(hh);
      }
      if (ids.size) {
        return [...ids].map((id) => ({ id, name: hhMap[id] || id }));
      }
    } catch {
      /* fallthrough */
    }
    return Object.entries(hhMap).map(([id, name]) => ({ id, name }));
  }
}
