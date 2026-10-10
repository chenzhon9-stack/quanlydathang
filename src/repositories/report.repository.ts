import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS as SheetName } from "@/lib/sheets/constants";
import { yearOfDate } from "@/lib/sheets/date";
import {
  mapOrderRow,
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
  Order,
  OrderDetail,
  Delivery,
  ProductionPlan,
  Payable,
  OpeningBalance,
} from "@/types";

const SHEETS = {
  orders: SheetName.DH,
  details: SheetName.CT,
  deliveries: SheetName.GH,
  plans: SheetName.KHSL,
  payables: SheetName.CN,
  opening: SheetName.DD,
};

/** Mock chỉ khi không production và Sheets chưa cấu hình / lỗi dev */
function allowMockData(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * KHSANLUONG giao năm báo cáo: startY ≤ year ≤ endY
 * (sau khi parse được ít nhất một đầu; không parse → loại).
 */
function planOverlapsYear(
  fromDate?: string,
  toDate?: string,
  year?: number
): boolean {
  if (year == null) return true;
  const y1 = yearOfDate(fromDate);
  const y2 = yearOfDate(toDate);
  if (y1 == null && y2 == null) return false;
  const startY = y1 ?? (y2 as number);
  const endY = y2 ?? (y1 as number);
  return startY <= year && endY >= year;
}

export class ReportRepository {
  static async getOrders(year: number): Promise<Order[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) {
        console.error(
          "[ReportRepository] Production thiếu Sheets — getOrders []"
        );
        return [];
      }
      return [];
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.orders, { year });
      const orders = rows.map(mapOrderRow).filter((o) => o.orderId);
      // Hợp đồng năm: khớp OrderRepository — chỉ dòng yearOfDate === year
      return orders.filter((o) => yearOfDate(o.orderDate) === year);
    } catch (e) {
      console.error("[ReportRepository] getOrders failed", e);
      return [];
    }
  }

  static async getDetails(year: number): Promise<OrderDetail[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) {
        console.error(
          "[ReportRepository] Production thiếu Sheets — getDetails []"
        );
        return [];
      }
      console.info("[ReportRepository] Sheets not configured → mock details");
      return getDetailsByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.details, { year });
      const details = rows.map(mapDetailRow).filter((d) => d.detailId);
      return details.filter((d) => {
        const y = yearOfDate(d.orderDate || d.receivedDate);
        return y == null || y === year;
      });
    } catch (e) {
      console.error("[ReportRepository] getDetails failed", e);
      // Sheets đã cấu hình: không mock
      return [];
    }
  }

  static async getDeliveries(year: number): Promise<Delivery[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) {
        console.error(
          "[ReportRepository] Production thiếu Sheets — getDeliveries []"
        );
        return [];
      }
      console.info(
        "[ReportRepository] Sheets not configured → mock deliveries"
      );
      return getDeliveriesByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.deliveries, { year });
      return rows.map(mapDeliveryRow).filter((d) => d.deliveryId);
    } catch (e) {
      console.error("[ReportRepository] getDeliveries failed", e);
      return [];
    }
  }

  static async getPlans(year: number): Promise<ProductionPlan[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) {
        console.error(
          "[ReportRepository] Production thiếu Sheets — getPlans []"
        );
        return [];
      }
      console.info("[ReportRepository] Sheets not configured → mock plans");
      return getPlansByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.plans, { year });
      let plans = rows.map(mapPlanRow).filter((p) => p.id);
      console.info(
        `[ReportRepository] KHSANLUONG raw=${rows.length} mapped=${plans.length} sample=${plans[0]?.id || "-"}`
      );
      // Giao khoảng: kế hoạch 2025–2027 vẫn hiện khi xem 2026
      const byYear = plans.filter((p) =>
        planOverlapsYear(p.fromDate, p.toDate, year)
      );
      if (byYear.length === 0 && plans.length > 0) {
        console.warn(
          `[ReportRepository] plans year=${year} overlap=0 total=${plans.length} — trả []`
        );
      }
      return byYear;
    } catch (e) {
      console.error(
        "[ReportRepository] getPlans failed (no mock when Sheets on)",
        e
      );
      return [];
    }
  }

  static async getPayables(year: number): Promise<Payable[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) {
        console.error(
          "[ReportRepository] Production thiếu Sheets — getPayables []"
        );
        return [];
      }
      console.info("[ReportRepository] Sheets not configured → mock payables");
      return getPayablesByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.payables, { year });
      let payables = rows.map(mapPayableRow).filter((p) => p.id);
      console.info(
        `[ReportRepository] NCC_CongNo raw=${rows.length} mapped=${payables.length} sample=${payables[0]?.id || "-"}`
      );
      // Service lọc theo yearStart..toDate
      return payables;
    } catch (e) {
      console.error(
        "[ReportRepository] getPayables failed (no mock when Sheets on)",
        e
      );
      return [];
    }
  }

  static async getOpening(year: number): Promise<OpeningBalance[]> {
    if (!isSheetsConfigured()) {
      if (!allowMockData()) return [];
      return getOpeningByYear(year);
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.opening, { year });
      let opening = rows.map(mapOpeningRow).filter((o) => o.id);
      console.info(
        `[ReportRepository] NCC_DuDauNam raw=${rows.length} mapped=${opening.length}`
      );
      const byYear = opening.filter((o) => !o.year || o.year === year);
      if (byYear.length === 0 && opening.length > 0) {
        console.warn(
          `[ReportRepository] opening year=${year} match=0 total=${opening.length} — trả [] (không return all)`
        );
      }
      return byYear;
    } catch (e) {
      console.error(
        "[ReportRepository] getOpening failed (no mock when Sheets on)",
        e
      );
      return [];
    }
  }
}
