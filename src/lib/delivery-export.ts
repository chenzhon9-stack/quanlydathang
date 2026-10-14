/**
 * Xuất Excel tab Giao hàng — parity V21 exportDeliveriesXlsx (ExcelJS, .xlsx).
 * Cột xuất = cột đang hiển thị (view) theo thứ tự người dùng chọn, bỏ cột exportable:false.
 */
import type { Delivery } from "@/types";

export type DeliveryExportCol = {
  header: string;
  kind: "text" | "date" | "num" | "price";
  /** Giá trị thô (chưa chuyển Excel) */
  get: (d: Delivery) => unknown;
};

/** NPP/KHACH/NCC/THUE_NGOAI → cn/dn/cc/tn (V21 adapter maHTVT) */
export function htvtExportCode(raw?: string): string {
  const map: Record<string, string> = {
    NPP: "cn",
    KHACH: "dn",
    NCC: "cc",
    THUE_NGOAI: "tn",
  };
  const v = String(raw || "").trim();
  return map[v] || v;
}

/** Trạng thái → số (V21): Mới tạo/Đặt hàng 0; Đã nhận/Đang giao/Hoàn thành 1; Hủy/Xóa -1 */
export function statusExportNumber(raw?: string): number {
  const s = String(raw || "").trim();
  const u = s.toUpperCase();
  const fold = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (u === "CANCEL" || u === "DELETE" || fold.includes("huy xe") || fold.includes("xoa xe"))
    return -1;
  if (
    u === "RECEIVED" ||
    u === "DELIVERING" ||
    u === "DONE" ||
    fold.includes("da nhan") ||
    fold.includes("dang giao") ||
    fold.includes("hoan thanh")
  )
    return 1;
  return 0;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Khai báo cột export theo key của DELIVERY_COLUMN_DEFS */
export const DELIVERY_EXPORT_COLS: Record<string, DeliveryExportCol> = {
  orderDate: { header: "Ngày đặt", kind: "date", get: (d) => d.orderDate },
  recvDate: { header: "Ngày nhận", kind: "date", get: (d) => d.receivedDate },
  plate: { header: "Biển số", kind: "text", get: (d) => d.vehiclePlate || d.vehicleId || "" },
  orderId: { header: "Mã đơn", kind: "text", get: (d) => d.orderId },
  supplierId: { header: "Mã NCC", kind: "text", get: (d) => d.supplierId },
  productId: { header: "Mã HH", kind: "text", get: (d) => d.productId },
  regionId: { header: "Mã khu vực", kind: "text", get: (d) => d.regionId },
  region: { header: "Tên khu vực", kind: "text", get: (d) => d.regionName },
  khoXuat: { header: "Kho xuất", kind: "text", get: (d) => d.warehouse },
  planned: { header: "KH giao", kind: "num", get: (d) => d.plannedQty },
  customerId: { header: "Mã KH", kind: "text", get: (d) => d.customerId },
  htvtCode: { header: "Mã HTVT", kind: "text", get: (d) => htvtExportCode(d.transportTypeId) },
  date: { header: "Ngày giao", kind: "date", get: (d) => d.deliveryDate },
  actual: { header: "Thực giao", kind: "num", get: (d) => d.actualQty },
  diff: {
    header: "Chênh lệch",
    kind: "num",
    get: (d) => n(d.plannedQty) - n(d.actualQty),
  },
  status: { header: "Trạng thái", kind: "num", get: (d) => statusExportNumber(d.detailStatus) },
  id: { header: "ID Giao hàng", kind: "text", get: (d) => d.deliveryId },
  detailId: { header: "ID Chi tiết", kind: "text", get: (d) => d.detailId },
  product: { header: "Hàng hóa", kind: "text", get: (d) => d.productName || d.productId },
  customer: { header: "Tên khách hàng", kind: "text", get: (d) => d.customerName || d.customerId },
  customerDetail: { header: "Chi tiết KH", kind: "text", get: (d) => d.customerDetail },
  vehicleId: { header: "Mã xe", kind: "text", get: (d) => d.vehicleId },
  htvt: { header: "Hình thức VT", kind: "text", get: (d) => d.transportTypeName || d.transportTypeId },
  carrierId: { header: "Mã ĐVVT", kind: "text", get: (d) => d.carrierId },
  carrierName: { header: "Đơn vị VT", kind: "text", get: (d) => d.carrierName },
  actualRecv: { header: "Thực nhận", kind: "num", get: (d) => d.actualReceived },
  ton: {
    header: "Tồn",
    kind: "num",
    get: (d) => Math.max(0, n(d.plannedQty) - n(d.actualQty)),
  },
  donGia: { header: "Đơn giá", kind: "price", get: (d) => d.unitPrice },
  isDuyenHa: { header: "Duyên Hà", kind: "text", get: (d) => (d.isDuyenHa ? "Có" : "Không") },
};

/** yyyy-MM-dd | dd/MM/yyyy (+giờ) → serial Excel nguyên, không phụ thuộc timezone */
export function excelDateSerial(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (mt) {
    y = Number(mt[1]);
    m = Number(mt[2]);
    d = Number(mt[3]);
  } else {
    mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
    if (!mt) return null;
    d = Number(mt[1]);
    m = Number(mt[2]);
    y = Number(mt[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

function ymdNow(): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return p.replace(/-/g, "");
}

function cellValue(col: DeliveryExportCol, d: Delivery): string | number | null {
  const v = col.get(d);
  if (col.kind === "date") return excelDateSerial(v);
  if (col.kind === "num") return Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : 0;
  if (col.kind === "price") {
    // V21: chưa có giá → ô trống
    return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  }
  return v == null ? "" : String(v);
}

export async function downloadDeliveriesXlsx(
  columnKeys: string[],
  rows: Delivery[]
): Promise<void> {
  const cols = columnKeys
    .map((k) => DELIVERY_EXPORT_COLS[k])
    .filter((c): c is DeliveryExportCol => !!c);
  if (!cols.length) throw new Error("Bạn chưa chọn cột nào để xuất Excel.");

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Giao hàng");
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E5F0" } };
    cell.border = border;
  });

  for (const d of rows) {
    const row = ws.addRow(cols.map((c) => cellValue(c, d)));
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      const col = cols[i - 1];
      if (!col) return;
      cell.border = border;
      if (col.kind === "date") {
        cell.numFmt = "dd/mm/yyyy";
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else if (col.kind === "num") {
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (col.kind === "price") {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    });
  }

  cols.forEach((c, i) => {
    let max = c.header.length;
    for (const d of rows) {
      const len =
        c.kind === "date" ? 10 : String(c.get(d) ?? "").length;
      if (len > max) max = len;
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 12), 35);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Hang_ngay_export_${ymdNow()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
