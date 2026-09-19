import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { mapOrderRow } from "@/mappers/sheet.mapper";
import { getOrdersByYear } from "@/mocks/data";
import type { Order } from "@/types";

/** Tên tab — chỉnh nếu workbook dùng tên khác */
const SHEET_ORDERS = "DonHang";

function applyFilters(
  rows: Order[],
  filter: {
    fromDate?: string;
    toDate?: string;
    status?: string;
    supplierId?: string;
  }
): Order[] {
  let out = rows;
  if (filter.fromDate) {
    out = out.filter((o) => o.orderDate >= filter.fromDate!);
  }
  if (filter.toDate) {
    out = out.filter((o) => o.orderDate <= filter.toDate!);
  }
  if (filter.status && filter.status !== "ALL") {
    out = out.filter((o) => o.status === filter.status);
  }
  if (filter.supplierId) {
    out = out.filter((o) => o.supplierId === filter.supplierId);
  }
  // newest first
  return out.sort((a, b) => b.orderDate.localeCompare(a.orderDate));
}

/**
 * OrderRepository — skill D64
 * Có env Service Account → đọc sheet DonHang; lỗi / thiếu env → mock.
 */
export class OrderRepository {
  static async findMany(filter: {
    year?: number;
    fromDate?: string;
    toDate?: string;
    status?: string;
    supplierId?: string;
  }): Promise<Order[]> {
    const year = filter.year ?? new Date().getFullYear();

    if (!isSheetsConfigured()) {
      console.info("[OrderRepository] Sheets not configured → mock orders");
      return applyFilters(getOrdersByYear(year), filter);
    }

    try {
      const rows = await readSheetAsObjects(SHEET_ORDERS, { year });
      let orders = rows
        .map(mapOrderRow)
        .filter((o) => o.orderId);

      // Lọc theo năm trên NgayDatHang nếu không có spreadsheet riêng theo năm
      orders = orders.filter(
        (o) => !o.orderDate || o.orderDate.startsWith(String(year))
      );

      console.info(
        `[OrderRepository] DonHang rows mapped: ${orders.length} (year=${year})`
      );
      return applyFilters(orders, filter);
    } catch (e) {
      console.error(
        "[OrderRepository] read DonHang failed → fallback mock",
        e
      );
      return applyFilters(getOrdersByYear(year), filter);
    }
  }

  static async findById(maDon: string, year?: number): Promise<Order | null> {
    const list = await this.findMany({ year });
    const id = maDon.trim();
    return (
      list.find((o) => o.orderId === id) ||
      list.find((o) => o.orderId.toLowerCase() === id.toLowerCase()) ||
      null
    );
  }
}
