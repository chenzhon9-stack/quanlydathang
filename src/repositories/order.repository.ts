import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { yearOfDate } from "@/lib/sheets/date";
import { mapOrderRow } from "@/mappers/sheet.mapper";
import { getOrdersByYear } from "@/mocks/data";
import type { Order } from "@/types";

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
  if (filter.fromDate) out = out.filter((o) => o.orderDate >= filter.fromDate!);
  if (filter.toDate) out = out.filter((o) => o.orderDate <= filter.toDate!);
  if (filter.status && filter.status !== "ALL")
    out = out.filter((o) => o.status === filter.status);
  if (filter.supplierId)
    out = out.filter((o) => o.supplierId === filter.supplierId);
  return out.sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
}

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
      console.info("[OrderRepository] Sheets not configured → mock");
      return applyFilters(getOrdersByYear(year), filter);
    }

    try {
      const rows = await readSheetAsObjects(SHEETS.DH, { year });
      console.info(
        `[OrderRepository] raw rows=${rows.length} keys0=${
          rows[0] ? Object.keys(rows[0]).slice(0, 8).join("|") : "empty"
        }`
      );

      let orders = rows.map(mapOrderRow).filter((o) => o.orderId);
      console.info(
        `[OrderRepository] after map MaDon=${orders.length} sample=${
          orders[0]?.orderId || "-"
        } date0=${orders[0]?.orderDate || "-"}`
      );

      // Lọc năm linh hoạt: nếu lọc hết → giữ toàn bộ (tránh tab trống)
      const byYear = orders.filter((o) => {
        const y = yearOfDate(o.orderDate);
        return y === null || y === year;
      });

      if (byYear.length === 0 && orders.length > 0) {
        console.warn(
          `[OrderRepository] year=${year} match=0 but total=${orders.length} → return all (date format?)`
        );
        return applyFilters(orders, filter);
      }

      console.info(
        `[OrderRepository] ${SHEETS.DH} year=${year} → ${byYear.length}`
      );
      return applyFilters(byYear, filter);
    } catch (e) {
      console.error("[OrderRepository] DonHang failed → mock", e);
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
