import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
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

/** Sheet names — adjust if your workbook uses different tab names */
const SHEETS = {
  details: "DonHang_Chitiet",
  deliveries: "Chitiet_Giaohang",
  plans: "KHSANLUONG",
  payables: "NCC_CongNo",
  opening: "NCC_DuDauNam",
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
      return rows
        .map(mapPlanRow)
        .filter((p) => p.id)
        .filter(
          (p) =>
            p.fromDate.startsWith(String(year)) ||
            p.toDate.startsWith(String(year)) ||
            !p.fromDate
        );
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
      return rows
        .map(mapPayableRow)
        .filter((p) => p.id)
        .filter((p) => !p.date || p.date.startsWith(String(year)));
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
      return rows
        .map(mapOpeningRow)
        .filter((o) => o.id)
        .filter((o) => o.year === year || !o.year);
    } catch (e) {
      console.error("[ReportRepository] getOpening failed, fallback mock", e);
      return getOpeningByYear(year);
    }
  }
}
