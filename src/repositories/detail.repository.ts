import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { yearOfDate } from "@/lib/sheets/date";
import { mapDetailRow } from "@/mappers/sheet.mapper";
import { getDetailsByYear } from "@/mocks/data";
import type { OrderDetail } from "@/types";

function applyFilters(
  rows: OrderDetail[],
  filter: {
    fromDate?: string;
    toDate?: string;
    status?: string;
    orderId?: string;
    supplierId?: string;
  }
): OrderDetail[] {
  let out = rows.filter((d) => d.status !== "DELETE");
  if (filter.fromDate)
    out = out.filter((d) => (d.orderDate || "") >= filter.fromDate!);
  if (filter.toDate)
    out = out.filter((d) => (d.orderDate || "") <= filter.toDate!);
  if (filter.status && filter.status !== "ALL")
    out = out.filter((d) => d.status === filter.status);
  if (filter.orderId) out = out.filter((d) => d.orderId === filter.orderId);
  if (filter.supplierId)
    out = out.filter((d) => d.supplierId === filter.supplierId);
  return out.sort((a, b) => {
    const d = (b.orderDate || "").localeCompare(a.orderDate || "");
    if (d !== 0) return d;
    return (b.detailId || "").localeCompare(a.detailId || "");
  });
}

export class DetailRepository {
  static async findMany(filter: {
    year?: number;
    fromDate?: string;
    toDate?: string;
    status?: string;
    orderId?: string;
    supplierId?: string;
  }): Promise<OrderDetail[]> {
    const year = filter.year ?? new Date().getFullYear();

    if (!isSheetsConfigured()) {
      console.info("[DetailRepository] Sheets not configured → mock");
      return applyFilters(getDetailsByYear(year), filter);
    }

    try {
      const rows = await readSheetAsObjects(SHEETS.CT, { year });
      let details = rows.map(mapDetailRow).filter((d) => d.detailId);
      console.info(
        `[DetailRepository] raw=${rows.length} mapped=${details.length} sample=${details[0]?.detailId || "-"}`
      );

      const byYear = details.filter((d) => {
        const y = yearOfDate(d.orderDate);
        return y === null || y === year;
      });
      if (byYear.length === 0 && details.length > 0) {
        console.warn(
          `[DetailRepository] year=${year} match=0 total=${details.length} → all`
        );
        return applyFilters(details, filter);
      }
      return applyFilters(byYear, filter);
    } catch (e) {
      console.error("[DetailRepository] DonHang_Chitiet failed → mock", e);
      return applyFilters(getDetailsByYear(year), filter);
    }
  }

  /** Parse năm từ CT-YYMMDD-#### (VD CT-261009-0020 → 2026) */
  static yearFromDetailId(detailId: string): number | null {
    const m = String(detailId || "").trim().match(/^CT-(\d{2})\d{4}-/i);
    if (!m) return null;
    const yy = Number(m[1]);
    if (!Number.isFinite(yy)) return null;
    return yy >= 70 ? 1900 + yy : 2000 + yy;
  }

  static async findById(detailId: string, year?: number) {
    const id = String(detailId || "").trim();
    if (!id) return null;
    const parsed = this.yearFromDetailId(id);
    const years: number[] = [];
    const push = (y: number | null | undefined) => {
      if (y == null || !Number.isFinite(y)) return;
      if (!years.includes(y)) years.push(y);
    };
    push(year);
    push(parsed);
    push(new Date().getFullYear());

    const match = (rows: OrderDetail[]) =>
      rows.find(
        (d) =>
          d.detailId === id ||
          String(d.detailId || "").toUpperCase() === id.toUpperCase()
      ) || null;

    for (const y of years) {
      const rows = await this.findMany({ year: y });
      const found = match(rows);
      if (found) return found;
    }
    return null;
  }

}
