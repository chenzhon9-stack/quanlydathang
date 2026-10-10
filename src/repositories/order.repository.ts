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
  // Ngày đặt DESC → Mã đơn ASC
  return out.sort((a, b) => {
    const d = (b.orderDate || "").localeCompare(a.orderDate || "");
    if (d !== 0) return d;
    return (a.orderId || "").localeCompare(b.orderId || "");
  });
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
      // Production thiếu cấu hình → [] (không mock như dữ liệu thật)
      if (process.env.NODE_ENV === "production") {
        console.error(
          "[OrderRepository] Production thiếu cấu hình Sheets — trả []"
        );
        return [];
      }
      console.info("[OrderRepository] Sheets not configured → mock (dev)");
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

      // Chỉ giữ đơn đúng năm. y === null (parse lỗi) → loại, không nhét mọi năm.
      // Production: KHÔNG fallback "return all" khi match=0 (tránh lộ kỳ + che bug ngày).
      const byYear = orders.filter((o) => {
        const y = yearOfDate(o.orderDate);
        return y === year;
      });

      if (byYear.length === 0 && orders.length > 0) {
        console.warn(
          `[OrderRepository] year=${year} match=0 but total=${orders.length} — trả [] (không return all; kiểm tra format NgayDatHang)`
        );
      }

      console.info(
        `[OrderRepository] ${SHEETS.DH} year=${year} → ${byYear.length}`
      );
      return applyFilters(byYear, filter);
    } catch (e) {
      console.error("[OrderRepository] DonHang failed", e);
      // Đã cấu hình Sheets / production: không đổ mock
      if (process.env.NODE_ENV === "production" || isSheetsConfigured()) {
        return [];
      }
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
