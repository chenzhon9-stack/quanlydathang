import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { yearOfDate } from "@/lib/sheets/date";
import { mapDeliveryRow } from "@/mappers/sheet.mapper";
import { getDeliveriesByYear } from "@/mocks/data";
import type { Delivery } from "@/types";

function applyFilters(
  rows: Delivery[],
  filter: {
    fromDate?: string;
    toDate?: string;
    detailId?: string;
    customerId?: string;
    includeDeleted?: boolean;
  }
): Delivery[] {
  let out = filter.includeDeleted ? rows : rows.filter((d) => !d.deleted);
  if (filter.fromDate)
    out = out.filter((d) => (d.deliveryDate || "") >= filter.fromDate!);
  if (filter.toDate)
    out = out.filter((d) => (d.deliveryDate || "") <= filter.toDate!);
  if (filter.detailId) out = out.filter((d) => d.detailId === filter.detailId);
  if (filter.customerId)
    out = out.filter((d) => d.customerId === filter.customerId);
  return out.sort((a, b) =>
    (b.deliveryDate || "").localeCompare(a.deliveryDate || "")
  );
}

export class DeliveryRepository {
  static async findMany(filter: {
    year?: number;
    fromDate?: string;
    toDate?: string;
    detailId?: string;
    customerId?: string;
    includeDeleted?: boolean;
  }): Promise<Delivery[]> {
    const year = filter.year ?? new Date().getFullYear();

    if (!isSheetsConfigured()) {
      console.info("[DeliveryRepository] Sheets not configured → mock");
      return applyFilters(getDeliveriesByYear(year), filter);
    }

    try {
      const rows = await readSheetAsObjects(SHEETS.GH, { year });
      let items = rows.map(mapDeliveryRow).filter((d) => d.deliveryId);
      console.info(
        `[DeliveryRepository] raw=${rows.length} mapped=${items.length} sample=${items[0]?.deliveryId || "-"}`
      );

      const byYear = items.filter((d) => {
        if (!d.deliveryDate) return true;
        const y = yearOfDate(d.deliveryDate);
        return y === null || y === year;
      });
      if (byYear.length === 0 && items.length > 0) {
        console.warn(
          `[DeliveryRepository] year=${year} match=0 total=${items.length} → all`
        );
        return applyFilters(items, filter);
      }
      return applyFilters(byYear, filter);
    } catch (e) {
      console.error("[DeliveryRepository] Chitiet_Giaohang failed → mock", e);
      return applyFilters(getDeliveriesByYear(year), filter);
    }
  }
}
