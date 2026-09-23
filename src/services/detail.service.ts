import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { DetailRepository } from "@/repositories/detail.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { updateSheetRowByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { STATUS_CT, todayYmdVN } from "@/lib/status";

export class DetailService {
  static async listDetails(
    filter: {
      year?: number;
      fromDate?: string;
      toDate?: string;
      status?: string;
      orderId?: string;
      supplierId?: string;
      page?: number;
      pageSize?: number;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (!hasPermission(user, "ORDER_VIEW") && !hasPermission(user, "*")) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xem chi tiết xe",
      };
    }

    let rows = await DetailRepository.findMany(filter);

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      rows = filterBySupplierIds(rows, allowed);
    }

    const [nccMap, hhMap, xeMap, kvMap, htvtMap] = await Promise.all([
      MasterRepository.nccNames(),
      MasterRepository.hhNames(),
      MasterRepository.xeNames(),
      MasterRepository.kvNames(),
      MasterRepository.htvtNames(),
    ]);
    rows = rows.map((d) => ({
      ...d,
      supplierName: (d as { supplierName?: string }).supplierName || nccMap[d.supplierId] || d.supplierId,
      productName: d.productName || hhMap[d.productId] || d.productId,
      vehiclePlate: xeMap[d.vehicleId] || d.vehicleId,
      regionName: kvMap[d.regionId] || d.regionId,
      transportTypeName: d.transportTypeName || htvtMap[d.transportTypeId || ""] || d.transportTypeId,
    })) as typeof rows;

    // Tổng thực giao theo CT (cho cột Tồn / Thực giao)
    try {
      const { DeliveryRepository } = await import("@/repositories/delivery.repository");
      const year = filter.year ?? new Date().getFullYear();
      const allGh = await DeliveryRepository.findMany({ year, includeDeleted: false });
      const sumByCt: Record<string, number> = {};
      for (const g of allGh) {
        sumByCt[g.detailId] = (sumByCt[g.detailId] || 0) + (Number(g.actualQty) || 0);
      }
      rows = rows.map((d) => ({
        ...d,
        actualDelivered: sumByCt[d.detailId] || 0,
      })) as typeof rows;
    } catch {
      /* optional */
    }

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 50));
    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }


  /** Nhận hàng — V21 saveReceive */
  static async receiveDetail(
    detailId: string,
    payload: { actualReceived: number; receivedDate?: string },
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_RECEIVE") &&
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền nhận hàng" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const qty = Number(payload.actualReceived);
    if (!(qty > 0)) {
      throw { code: "VALIDATION_ERROR", message: "Thực nhận phải > 0" };
    }
    const ngay = (payload.receivedDate || todayYmdVN()).slice(0, 10);
    const y = year ?? new Date().getFullYear();
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        ThucNhan: qty,
        NgayNhanHang: ngay,
        TrangThaiXe: STATUS_CT.RECEIVED,
        TimeChange: new Date().toISOString(),
        User: user.email,
      },
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    return { detailId, actualReceived: qty, receivedDate: ngay, status: "RECEIVED", row };
  }

  /** Hủy / Xóa xe — V21 cancelDetail */
  static async cancelDetail(
    detailId: string,
    mode: "cancel" | "delete",
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "ORDER_CANCEL") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền hủy chi tiết" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const status = mode === "delete" ? STATUS_CT.DELETE : STATUS_CT.CANCEL;
    const y = year ?? new Date().getFullYear();
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        TrangThaiXe: status,
        ThucNhan: 0,
        TimeChange: new Date().toISOString(),
        User: user.email,
      },
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    return { detailId, status: mode === "delete" ? "DELETE" : "CANCEL", row };
  }


  /** Sửa hàng / khu vực / ghi chú — V21 saveEditDetail */
  static async updateDetail(
    detailId: string,
    payload: {
      productId?: string;
      regionId?: string;
      note?: string;
    },
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "ORDER_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền sửa chi tiết" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Google Sheets" };
    }
    const patch: Record<string, string | number | boolean> = {
      TimeChange: new Date().toISOString(),
      User: user.email,
    };
    if (payload.productId !== undefined) patch.MaHH = payload.productId;
    if (payload.regionId !== undefined) patch.Khuvuc = payload.regionId;
    if (payload.note !== undefined) patch.GhiChu = payload.note;
    const y = year ?? new Date().getFullYear();
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      patch,
      y
    );
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    return { detailId, ...payload, row };
  }
}
