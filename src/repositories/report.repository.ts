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
  const y1 = fromDate ? yearOfDate(fromDate) : null;
  const y2 = toDate ? yearOfDate(toDate) : null;
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
      return orders.filter((o) => {
        if (!o.orderDate) return false;
        return yearOfDate(o.orderDate) === year;
      });
    } catch (e) {
      console.error("[ReportRepository] getOrders failed", e);
      return [];
    }
  }

  /**
   * Đọc CT từ spreadsheet năm `year` (đúng 1 file sheet).
   * Dữ liệu cross-year đã lưu trên sheet năm phát sinh nhận/giao → không suy từ năm đặt.
   * Giữ mọi dòng có ID trên sheet; lọc kỳ nhận/giao ở tầng service.
   */
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
      return rows.map(mapDetailRow).filter((d) => d.detailId);
    } catch (e) {
      console.error("[ReportRepository] getDetails failed", e);
      return [];
    }
  }

  /**
   * Các năm spreadsheet cần đọc theo khoảng from–to.
   * - Cùng 1 năm → [Y] (1 sheet)
   * - Span 2 năm → [Y1, Y2] (chỉ khi from/to khác năm)
   * Không phụ thuộc năm đặt hàng.
   */
  static yearsForDateRange(
    fromDate?: string | null,
    toDate?: string | null,
    fallbackYear?: number
  ): number[] {
    const y1 = fromDate ? yearOfDate(String(fromDate).slice(0, 10)) : null;
    const y2 = toDate ? yearOfDate(String(toDate).slice(0, 10)) : null;
    if (y1 != null && y2 != null) {
      const a = Math.min(y1, y2);
      const b = Math.max(y1, y2);
      const out: number[] = [];
      for (let y = a; y <= b; y++) out.push(y);
      return out;
    }
    if (y1 != null) return [y1];
    if (y2 != null) return [y2];
    const fb = fallbackYear ?? new Date().getFullYear();
    return [fb];
  }

  /** Đọc CT nhiều năm, khử trùng ID_Chitiet (ưu tiên năm đứng trước trong mảng). */
  static async getDetailsForYears(years: number[]): Promise<OrderDetail[]> {
    const uniq = [...new Set(years.filter((y) => Number(y) > 1900))].sort(
      (a, b) => b - a
    ); // năm mới trước → ưu tiên bản sheet năm gần hơn
    if (!uniq.length) return [];
    const chunks = await Promise.all(uniq.map((y) => this.getDetails(y)));
    const seen = new Set<string>();
    const out: OrderDetail[] = [];
    for (const d of chunks.flat()) {
      if (!d.detailId || seen.has(d.detailId)) continue;
      seen.add(d.detailId);
      out.push(d);
    }
    return out;
  }

  /**
   * Chi tiết có **ngày nhận** thuộc năm tài chính `year`.
   * Chỉ đọc **1 sheet năm `year`** — dữ liệu đặt năm trước / nhận năm nay
   * đã được lưu trên sheet năm nhận (không tự đọc year-1).
   */
  static async getDetailsForReceiveYear(year: number): Promise<OrderDetail[]> {
    const details = await this.getDetails(year);
    const out: OrderDetail[] = [];
    for (const d of details) {
      if (!d.detailId) continue;
      const yRecv = d.receivedDate ? yearOfDate(d.receivedDate) : null;
      if (yRecv !== year) continue;
      const tons = Number(d.actualReceived);
      if (!Number.isFinite(tons) || tons <= 0) continue;
      out.push(d);
    }
    return out;
  }

  /**
   * CT theo khoảng ngày nhận from–to.
   * Cùng năm → 1 sheet; khác năm → đúng các sheet trong khoảng.
   */
  static async getDetailsForReceiveDateRange(
    fromDate: string,
    toDate: string
  ): Promise<OrderDetail[]> {
    const years = this.yearsForDateRange(fromDate, toDate);
    const details = await this.getDetailsForYears(years);
    const from = String(fromDate || "").slice(0, 10);
    const to = String(toDate || "").slice(0, 10);
    return details.filter((d) => {
      const dt = (d.receivedDate || "").slice(0, 10);
      if (!dt) return false;
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      const tons = Number(d.actualReceived);
      return Number.isFinite(tons) && tons > 0;
    });
  }

  /**
   * Giao hàng có **ngày giao** thuộc năm `year` — chỉ 1 sheet năm đó.
   */
  static async getDeliveriesForDeliveryYear(year: number): Promise<Delivery[]> {
    const rows = await this.getDeliveries(year);
    const out: Delivery[] = [];
    for (const d of rows) {
      if (!d.deliveryId || d.deleted) continue;
      const yDel = d.deliveryDate ? yearOfDate(d.deliveryDate) : null;
      if (yDel !== year) continue;
      out.push(d);
    }
    return out;
  }

  /**
   * GH theo khoảng ngày giao from–to (1 hoặc 2 sheet tùy span năm).
   */
  static async getDeliveriesForDeliveryDateRange(
    fromDate: string,
    toDate: string
  ): Promise<Delivery[]> {
    const years = this.yearsForDateRange(fromDate, toDate);
    const uniq = [...new Set(years)];
    const chunks = await Promise.all(uniq.map((y) => this.getDeliveries(y)));
    const seen = new Set<string>();
    const from = String(fromDate || "").slice(0, 10);
    const to = String(toDate || "").slice(0, 10);
    const out: Delivery[] = [];
    for (const d of chunks.flat()) {
      if (!d.deliveryId || seen.has(d.deliveryId) || d.deleted) continue;
      const dt = (d.deliveryDate || "").slice(0, 10);
      if (!dt) continue;
      if (from && dt < from) continue;
      if (to && dt > to) continue;
      seen.add(d.deliveryId);
      out.push(d);
    }
    return out;
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
