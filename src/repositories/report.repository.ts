import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS as SheetName } from "@/lib/sheets/constants";
import { yearOfDate } from "@/lib/sheets/date";
import {
  mapDetailRow,
  mapDeliveryRow,
  mapPlanRow,
  mapPayableRow,
  mapOpeningRow,
} from "@/mappers/sheet.mapper";
import {
  getDetailsByYear,
  getDeliveriesByYear,
  getPlansByYear,
  getPayablesByYear,
  getOpeningByYear,
} from "@/mocks/data";
import type {
  OrderDetail,
  Delivery,
  ProductionPlan,
  Payable,
  OpeningBalance,
} from "@/types";

const SHEETS = {
  details: SheetName.CT,
  deliveries: SheetName.GH,
  plans: SheetName.KHSL,
  payables: SheetName.CN,
  opening: SheetName.DD,
};

export class ReportRepository {
  static async getDetails(year: number): Promise<OrderDetail[]> {
    if (!isSheetsConfigured()) {
      console.info("[ReportRepository] Sheets not configured → mock details");
      return getDetailsByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.details, { year });
      return rows.map(mapDetailRow).filter((d) => d.detailId);
    } catch (e) {
      console.error("[ReportRepository] getDetails failed, fallback mock", e);
      return getDetailsByYear(year);
    }
  }

  static async getDeliveries(year: number): Promise<Delivery[]> {
    if (!isSheetsConfigured()) {
      console.info("[ReportRepository] Sheets not configured → mock deliveries");
      return getDeliveriesByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.deliveries, { year });
      return rows.map(mapDeliveryRow).filter((d) => d.deliveryId);
    } catch (e) {
      console.error("[ReportRepository] getDeliveries failed, fallback mock", e);
      return getDeliveriesByYear(year);
    }
  }

  static async getPlans(year: number): Promise<ProductionPlan[]> {
    if (!isSheetsConfigured()) {
      console.info("[ReportRepository] Sheets not configured → mock plans");
      return getPlansByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.plans, { year });
      let plans = rows.map(mapPlanRow).filter((p) => p.id);
      console.info(
        `[ReportRepository] KHSANLUONG raw=${rows.length} mapped=${plans.length} sample=${plans[0]?.id || "-"}`
      );
      const byYear = plans.filter((p) => {
        const y1 = yearOfDate(p.fromDate);
        const y2 = yearOfDate(p.toDate);
        return y1 === year || y2 === year || y1 === null;
      });
      if (byYear.length === 0 && plans.length > 0) {
        console.warn(
          `[ReportRepository] plans year=${year} match=0 total=${plans.length} → all`
        );
        return plans;
      }
      return byYear;
    } catch (e) {
      console.error("[ReportRepository] getPlans failed, fallback mock", e);
      return getPlansByYear(year);
    }
  }

  static async getPayables(year: number): Promise<Payable[]> {
    if (!isSheetsConfigured()) {
      console.info("[ReportRepository] Sheets not configured → mock payables");
      return getPayablesByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.payables, { year });
      let payables = rows.map(mapPayableRow).filter((p) => p.id);
      console.info(
        `[ReportRepository] NCC_CongNo raw=${rows.length} mapped=${payables.length} sample=${payables[0]?.id || "-"}`
      );
      const byYear = payables.filter((p) => {
        if (!p.date) return true;
        const y = yearOfDate(p.date);
        return y === null || y === year;
      });
      if (byYear.length === 0 && payables.length > 0) {
        console.warn(
          `[ReportRepository] payables year=${year} match=0 total=${payables.length} → all`
        );
        return payables;
      }
      return byYear;
    } catch (e) {
      console.error("[ReportRepository] getPayables failed, fallback mock", e);
      return getPayablesByYear(year);
    }
  }

  static async getOpening(year: number): Promise<OpeningBalance[]> {
    if (!isSheetsConfigured()) {
      return getOpeningByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.opening, { year });
      let opening = rows.map(mapOpeningRow).filter((o) => o.id);
      console.info(
        `[ReportRepository] NCC_DuDauNam raw=${rows.length} mapped=${opening.length}`
      );
      const byYear = opening.filter((o) => !o.year || o.year === year);
      if (byYear.length === 0 && opening.length > 0) return opening;
      return byYear;
    } catch (e) {
      console.error("[ReportRepository] getOpening failed, fallback mock", e);
      return getOpeningByYear(year);
    }
  }
}
