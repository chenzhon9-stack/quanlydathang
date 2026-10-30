import { writeAudit } from "@/lib/sheets/audit";
import { formatDateTimeVN, ymdDate, todayYmdVN, currentYearVN } from "@/lib/sheets/date";
import type { AccessScope, UserContext } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
  resolveOwnerOrderIdSet,
  filterByOwnerOrderIds, applyListScopeFilter } from "@/lib/scope";
import { DetailRepository } from "@/repositories/detail.repository";
import { OrderRepository } from "@/repositories/order.repository";
import { MasterRepository } from "@/repositories/master.repository";
import { updateSheetRowByKey, updateSheetRowsByKey } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { STATUS_CT } from "@/lib/status";
import {
  qty3,
  validateStep,
  validateReceiveDate,
  roundToStep,
  computeDetailStatus,
  normalizeHaohut,
  isHangBao,
} from "@/lib/business-rules";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { reallocatePlanOnReceive } from "@/lib/plan-reallocate";
import { assertOrderInScope, isThueNgoaiHtvt } from "@/lib/write-guards";
import { syncOrderStatusByDetailId } from "@/lib/sync-order-status";
import {
  diffDetailMasterFields,
  markOrderResendIfSent,
} from "@/lib/order-resend";

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

    // V21.07 multi-role scope union
    rows = await applyListScopeFilter(rows, scope, filter.year);

    const [nccMap, hhMap, xeMap, kvMap, htvtMap, hhMeta, dvtMap, ctVtRows] =
      await Promise.all([
        MasterRepository.nccNames(),
        MasterRepository.hhNames(),
        MasterRepository.xeNames(),
        MasterRepository.kvNames(),
        MasterRepository.htvtNames(),
        MasterRepository.hhMeta(),
        MasterRepository.dvtNames().catch(() => ({} as Record<string, string>)),
        readSheetAsObjects(SHEETS.CT_VT, {
          year: filter.year ?? currentYearVN(),
        }).catch(() => [] as Record<string, string>[]),
      ]);
    const carrierByCt = new Map<string, string>();
    for (const r of ctVtRows) {
      const id = String(r.ID_Chitiet || r.id_chitiet || "").trim();
      const maDvt = String(r.MaDVT || r.maDVT || "").trim();
      if (id && maDvt) carrierByCt.set(id, maDvt);
    }
    rows = rows.map((d) => {
      const meta =
        hhMeta[d.productId] ||
        hhMeta[String(d.productId || "").toUpperCase()];
      const carrierId =
        d.carrierId || carrierByCt.get(String(d.detailId || "").trim()) || "";
      return {
        ...d,
        supplierName:
          (d as { supplierName?: string }).supplierName ||
          nccMap[d.supplierId] ||
          d.supplierId,
        productName: d.productName || hhMap[d.productId] || d.productId,
        vehiclePlate: xeMap[d.vehicleId] || d.vehicleId,
        regionName: kvMap[d.regionId] || d.regionId,
        transportTypeName:
          d.transportTypeName ||
          htvtMap[d.transportTypeId || ""] ||
          d.transportTypeId,
        carrierId: carrierId || undefined,
        carrierName: carrierId
          ? dvtMap[carrierId] || carrierId
          : d.carrierName,
        // Enrich từ DM_HangHoa — FE khóa Bao + validate chia hết
        phanLoai: (meta?.phanLoai as typeof d.phanLoai) || d.phanLoai,
        tyleChiahet:
          meta?.tyleChiahet != null
            ? meta.tyleChiahet
            : (d as { tyleChiahet?: number }).tyleChiahet,
      };
    }) as typeof rows;

    // PDF FileDonhang
    try {
      const { OrderRepository } = await import("@/repositories/order.repository");
      const year = filter.year ?? currentYearVN();
      const orders = await OrderRepository.findMany({ year });
      const fileByOrder = new Map(
        orders
          .filter((o) => o.orderId && o.orderFile)
          .map((o) => [String(o.orderId).trim(), String(o.orderFile)])
      );
      rows = rows.map((d) => ({
        ...d,
        orderFile: d.orderFile || fileByOrder.get(String(d.orderId || "").trim()),
      }));
    } catch {
      /* ignore */
    }

    // Tổng thực giao theo CT (cho cột Tồn / Thực giao)
    try {
      const { DeliveryRepository } = await import("@/repositories/delivery.repository");
      const year = filter.year ?? currentYearVN();
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
    let items = rows.slice(start, start + pageSize);

    // canWrite theo write-scope đơn cha — khóa Nhận/Hủy/Sửa trên UI
    try {
      const {
        resolveWritableOrderIdSet,
        orderIdWritable,
      } = await import("@/lib/order-write-flags");
      const writable = await resolveWritableOrderIdSet(
        user,
        filter.year ?? currentYearVN()
      );
      items = items.map((d) => ({
        ...d,
        canWrite: orderIdWritable(d.orderId, writable),
      }));
    } catch (e) {
      console.error("[listDetails] canWrite", e);
      items = items.map((d) => ({ ...d, canWrite: false }));
    }

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: start + items.length < total,
    };
  }


  /**
   * Nhận hàng — parity V21 confirmReceiveDetail
   * - permission ORDER_RECEIVE
   * - status not CANCEL/DELETE/DONE
   * - ThucNhan > 0 + chia hết TyleChiahet
   * - ngày nhận hợp lệ
   * - ghi CT → Đã nhận
   * - nếu ThucNhan ≠ SoLuong: phân bổ tỷ lệ KHgiao (active GH)
   */
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

    const y = year ?? currentYearVN();
    const ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    await assertOrderInScope(
      ct.orderId,
      user,
      y,
      "Chi tiết thuộc đơn ngoài phạm vi — không được nhận hàng."
    );

    const st = String(ct.status || "").toUpperCase();
    // status domain enum or VN
    const blocked = ["CANCEL", "DELETE", "DONE", "HỦY XE", "XÓA XE", "HOÀN THÀNH"];
    if (blocked.includes(st) || ["Hủy xe", "Xóa xe", "Hoàn thành"].includes(String(ct.status))) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Chi tiết đã hủy/xóa hoặc hoàn thành, không được nhận hàng.",
      };
    }

    // R3: phải có kế hoạch giao hợp lệ (Σ KHgiao > 0)
    {
      const { DeliveryRepository } = await import(
        "@/repositories/delivery.repository"
      );
      const ghs = await DeliveryRepository.findMany({
        year: y,
        detailId,
        includeDeleted: false,
      });
      const sumPlan = ghs
        .filter((g) => !g.deleted)
        .reduce((s, g) => s + (Number(g.plannedQty) || 0), 0);
      if (!(sumPlan > 0)) {
        throw {
          code: "VALIDATION_ERROR",
          message:
            "Chi tiết này chưa có kế hoạch giao hợp lệ, không thể nhận hàng.",
        };
      }
    }

    // TyleChiahet + PhanLoaiHH từ DM_HangHoa
    let tyleChiahet = 0;
    let tenHH = ct.productName || ct.productId;
    let phanLoai = String(ct.phanLoai || "");
    try {
      const hhRows = await readSheetAsObjects(SHEETS.HH, {});
      const hh = hhRows.find(
        (r) =>
          String(r.MaHH || "").trim().toUpperCase() ===
          String(ct.productId || "").trim().toUpperCase()
      );
      if (hh) {
        tyleChiahet = Number(hh.TyleChiahet || hh.TyleChiaHet || 0) || 0;
        tenHH = String(hh.TenHangHoa || tenHH);
        phanLoai = String(hh.PhanLoaiHH || hh.PhanLoai || phanLoai);
      }
    } catch {
      /* optional */
    }

    // V21: hàng Bao → thực nhận = đúng SoLuong đặt (không cho lệch)
    let qty = qty3(Number(payload.actualReceived));
    if (isHangBao(phanLoai)) {
      qty = qty3(Number(ct.quantity) || 0);
    }
    if (!(qty > 0)) {
      throw { code: "VALIDATION_ERROR", message: "Thực nhận phải > 0" };
    }

    // Chia hết TyleChiahet (kể cả Bao — SL đặt cũng phải hợp lệ)
    if (!validateStep(qty, tyleChiahet)) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Thực nhận của ${tenHH} phải chia hết cho ${tyleChiahet}. Giá trị hiện tại: ${qty.toFixed(2)} tấn.`,
      };
    }

    const ngay = (payload.receivedDate || todayYmdVN()).slice(0, 10);
    const dateCheck = validateReceiveDate({
      orderDate: ct.orderDate,
      receivedDate: ngay,
      isDuyenHa: !!ct.isDuyenHa,
    });
    if (!dateCheck.ok) {
      throw { code: "VALIDATION_ERROR", message: dateCheck.error };
    }

    // Phân bổ lại KHgiao — V21 _phanBoLaiKeHoachGiao_: khách thật × tỷ lệ, khách đệm (acghang/B/R) nhận phần dư
    // (tính trước, chưa ghi — để gộp ghi CT 1 lần + GH 1 lô)
    const planQty = qty3(Number(ct.quantity) || 0);
    let plan: Map<string, number> | null = null;
    let syncSoLuong = false;
    try {
      const { DeliveryRepository } = await import(
        "@/repositories/delivery.repository"
      );
      const ghs = await DeliveryRepository.findMany({
        year: y,
        detailId,
        includeDeleted: false,
      });
      const active = ghs.filter((g) => !g.deleted);
      plan = reallocatePlanOnReceive(
        active.map((g) => ({
          id: g.deliveryId,
          customerId: String(g.customerId || ""),
          planned: Number(g.plannedQty) || 0,
        })),
        qty,
        tyleChiahet
      );
      // Đồng bộ SoLuong CT = thực nhận khi lệch SoLuong đặt
      syncSoLuong =
        planQty > 0 && Math.abs(qty - planQty) > 0.0001 && active.length > 0;
    } catch (e) {
      console.error("[receiveDetail] tính phân bổ GH", e);
    }

    // 1 lần ghi CT: nhận hàng (+ SoLuong nếu cần)
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        ThucNhan: qty,
        NgayNhanHang: ngay,
        TrangThaiXe: STATUS_CT.RECEIVED,
        TimeChange: formatDateTimeVN(),
        User: user.email,
        ...(syncSoLuong ? { SoLuong: qty } : {}),
      },
      y
    );
    if (row < 0) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    // 1 lô ghi GH (thay cho mỗi GH 2 lời gọi)
    let redistributed = 0;
    let redistributeFailed = false;
    if (plan && plan.size > 0) {
      try {
        await updateSheetRowsByKey(
          SHEETS.GH,
          "ID_Giaohang",
          [...plan].map(([deliveryId, newKh]) => ({
            key: deliveryId,
            patch: { KHgiao: newKh },
          })),
          y
        );
        redistributed = plan.size;
      } catch (e) {
        console.error("[receiveDetail] redistribute GH", e);
        redistributeFailed = true;
      }
    }

    const sync = await syncOrderStatusByDetailId(detailId, y).catch(() => null);
    
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "RECEIVE_DETAIL",
      maDon: ct.orderId,
      idCt: detailId,
      targetId: detailId,
      oldValue: { thucNhan: ct.actualReceived, status: ct.status },
      newValue: {
        actualReceived: qty,
        receivedDate: ngay,
        redistributed,
      },
      lyDo: isHangBao(phanLoai)
        ? "Nhận hàng Bao (ép = SoLuong)"
        : "Nhận hàng",
      year: y,
    });

    if (redistributeFailed) {
      throw {
        code: "PARTIAL_WRITE",
        message:
          "Đã lưu thực nhận nhưng phân bổ lại kế hoạch giao (GH) thất bại. Vui lòng bấm lưu nhận hàng lại.",
      };
    }

    return {
      detailId,
      actualReceived: qty,
      receivedDate: ngay,
      status: "RECEIVED",
      row,
      tyleChiahet,
      redistributed,
      orderStatus: sync?.status,
      message:
        redistributed > 0
          ? `Đã nhận ${qty} tấn; phân bổ lại ${redistributed} dòng KH giao`
          : `Đã nhận ${qty} tấn`,
    };
  }

  /**
   * Hủy / Xóa xe — V21 cancelDetailById
   * - Chưa gửi NCC (LanGui=0, không timeGuimail/FileDonhang, status NEW):
   *     → Xóa xe (DELETE) + soft-delete toàn bộ GH của CT
   * - Đã gửi NCC:
   *     → Hủy xe (CANCEL), bật GuiLaimail trên đơn, KHÔNG soft-delete GH
   * mode client chỉ là gợi ý; quyết định cuối theo trạng thái gửi đơn.
   */
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
    const y = year ?? currentYearVN();
    const { DeliveryRepository } = await import(
      "@/repositories/delivery.repository"
    );
    const { OrderRepository } = await import(
      "@/repositories/order.repository"
    );

    const ct = await DetailRepository.findById(detailId, y);
    if (!ct) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }
    // Write-scope fail-closed (không bỏ qua khi không đọc được đơn cha)
    await assertOrderInScope(
      ct.orderId,
      user,
      y,
      "Chi tiết thuộc đơn ngoài phạm vi — không được hủy/xóa."
    );
    if ((Number(ct.actualReceived) || 0) > 0) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Xe đã nhận ${ct.actualReceived} tấn, không được hủy/xóa.`,
      };
    }

    const ghs = await DeliveryRepository.findMany({
      year: y,
      detailId,
      includeDeleted: false,
    });
    const totalTg = ghs
      .filter((g) => !g.deleted)
      .reduce((s, g) => s + (Number(g.actualQty) || 0), 0);
    if (totalTg > 0) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Xe đã có ${totalTg} tấn thực giao, không được hủy/xóa.`,
      };
    }

    // V21 _isOrderSentForCancel_
    const order = await OrderRepository.findById(ct.orderId, y).catch(() => null);
    const orderSent = !!(
      order &&
      ((Number(order.sendCount) || 0) > 0 ||
        !!String(order.mailSentAt || "").trim() ||
        !!String(order.orderFile || "").trim() ||
        (String(order.status || "").toUpperCase() !== "NEW" &&
          String(order.status || "") !== "Khởi tạo" &&
          String(order.status || "") !== "Mới tạo"))
    );
    // Ưu tiên rule nghiệp vụ hơn mode UI
    const effectiveMode: "cancel" | "delete" = orderSent ? "cancel" : "delete";

    const now = formatDateTimeVN();
    let deletedGh = 0;

    // Chỉ soft-delete GH khi Xóa xe (chưa gửi NCC)
    if (effectiveMode === "delete") {
      for (const g of ghs) {
        if ((Number(g.actualQty) || 0) > 0) continue;
        const r = await updateSheetRowByKey(
          SHEETS.GH,
          "ID_Giaohang",
          g.deliveryId,
          { Deleted: true, DeletedAt: now, DeletedBy: user.email },
          y
        );
        if (r > 0) deletedGh++;
      }
    }

    const status =
      effectiveMode === "delete" ? STATUS_CT.DELETE : STATUS_CT.CANCEL;
    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      {
        TrangThaiXe: status,
        ThucNhan: 0,
        TimeChange: now,
        User: user.email,
      },
      y
    );
    if (row < 0) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    // Sau khi gửi NCC: bật GuiLaimail để gửi lại đơn
    if (effectiveMode === "cancel" && ct.orderId) {
      await updateSheetRowByKey(
        SHEETS.DH,
        "MaDon",
        ct.orderId,
        {
          GuiLaimail: true,
          TrangThaiDon: "Đang xử lý",
        },
        y
      ).catch(() => null);
    }

    const sync = await syncOrderStatusByDetailId(detailId, y).catch(() => null);
    
    await writeAudit({
      email: user.email,
      role: user.role,
      action:
        effectiveMode === "delete" ? "DELETE_DETAIL" : "CANCEL_DETAIL",
      maDon: ct.orderId,
      idCt: detailId,
      targetId: detailId,
      oldValue: { status: ct.status, orderSent },
      newValue: {
        status: effectiveMode === "delete" ? "DELETE" : "CANCEL",
        deletedGh,
      },
      lyDo:
        effectiveMode === "delete"
          ? "Xóa xe (đơn chưa gửi NCC)"
          : "Hủy xe (đơn đã gửi) + GuiLaimail",
      year: y,
    });

    return {
      detailId,
      status: effectiveMode === "delete" ? "DELETE" : "CANCEL",
      mode: effectiveMode === "delete" ? "delete_before_send" : "cancel_after_send",
      requestedMode: mode,
      orderSent,
      row,
      deletedGh,
      orderStatus: sync?.status,
    };
  }


  /**
   * Sửa hàng / KV / ghi chú / xe / HTVT / ĐVT — V21 updateDetailEdit + _updateDetailAndMarkResend_
   * Đơn đã gửi + đổi field quan trọng → GuiLaimail=true (gửi lại NCC).
   * THUE_NGOAI → upsert DonHang_VanTai (CT_VT); không thuê → xóa MaDVT trên CT_VT nếu có.
   */
  static async updateDetail(
    detailId: string,
    payload: {
      productId?: string;
      regionId?: string;
      note?: string;
      vehicleId?: string;
      quantity?: number;
      transportTypeId?: string;
      transportTypeName?: string;
      carrierId?: string;
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
    const y = year ?? currentYearVN();
    const oldCt = await DetailRepository.findById(detailId, y);
    if (!oldCt) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };
    }

    // CT_VT hiện tại (MaDVT) — để so sánh đổi ĐVT
    let oldCarrierId = String(oldCt.carrierId || "").trim();
    if (!oldCarrierId) {
      try {
        const vtRows = await readSheetAsObjects(SHEETS.CT_VT, { year: y });
        const vt = vtRows.find(
          (r) =>
            String(r.ID_Chitiet || r.id_chitiet || "").trim() ===
            String(detailId).trim()
        );
        if (vt) oldCarrierId = String(vt.MaDVT || vt.maDVT || "").trim();
      } catch {
        /* ignore */
      }
    }

    await assertOrderInScope(
      oldCt.orderId,
      user,
      y,
      "Chi tiết thuộc đơn ngoài phạm vi — không được sửa."
    );

    // THUE_NGOAI bắt buộc có ĐVT (kể cả xe cũ) — parity GAS, kiểm tra phía server
    {
      const htvtNext = String(
        payload.transportTypeId ?? oldCt.transportTypeId ?? ""
      );
      const carrierNext =
        payload.carrierId !== undefined
          ? String(payload.carrierId || "").trim()
          : oldCarrierId;
      if (
        isThueNgoaiHtvt(htvtNext) &&
        !carrierNext &&
        (payload.transportTypeId !== undefined || payload.carrierId !== undefined)
      ) {
        throw {
          code: "VALIDATION_ERROR",
          message: "Hình thức Thuê ngoài bắt buộc chọn đơn vị vận tải.",
        };
      }
    }

    const patch: Record<string, string | number | boolean> = {
      TimeChange: formatDateTimeVN(),
      User: user.email,
    };
    if (payload.productId !== undefined) patch.MaHH = payload.productId;
    if (payload.regionId !== undefined) patch.Khuvuc = payload.regionId;
    if (payload.note !== undefined) patch.GhiChu = payload.note;
    if (payload.vehicleId !== undefined) patch.MaXe = payload.vehicleId;
    if (payload.quantity !== undefined)
      patch.SoLuong = qty3(Number(payload.quantity) || 0);
    if (payload.transportTypeId !== undefined)
      patch.MaHTVT = payload.transportTypeId;
    if (payload.transportTypeName !== undefined)
      patch.TenHTVT = payload.transportTypeName;

    const changed = diffDetailMasterFields(
      {
        vehicleId: oldCt.vehicleId,
        productId: oldCt.productId,
        regionId: oldCt.regionId,
        note: oldCt.note,
        quantity: oldCt.quantity,
        transportTypeId: oldCt.transportTypeId,
        carrierId: oldCarrierId,
      },
      {
        vehicleId: payload.vehicleId,
        productId: payload.productId,
        regionId: payload.regionId,
        note: payload.note,
        quantity: payload.quantity,
        hasQuantity: payload.quantity !== undefined,
        transportTypeId: payload.transportTypeId,
        carrierId: payload.carrierId,
      }
    );

    const row = await updateSheetRowByKey(
      SHEETS.CT,
      "ID_Chitiet",
      detailId,
      patch,
      y
    );
    if (row < 0)
      throw { code: "NOT_FOUND", message: "Không tìm thấy chi tiết " + detailId };

    // DonHang_VanTai (CT_VT) — parity GAS updateDetailEdit
    const nextHtvt = String(
      payload.transportTypeId ?? oldCt.transportTypeId ?? ""
    ).toUpperCase();
    const nextVehicle = String(payload.vehicleId ?? oldCt.vehicleId ?? "").trim();
    const nextCarrier =
      payload.carrierId !== undefined
        ? String(payload.carrierId || "").trim()
        : oldCarrierId;
    const isThue = nextHtvt === "THUE_NGOAI" || isThueNgoaiHtvt(nextHtvt);
    try {
      const { appendSheetRow } = await import("@/lib/sheets/dal");
      if (isThue && nextCarrier) {
        const updated = await updateSheetRowByKey(
          SHEETS.CT_VT,
          "ID_Chitiet",
          detailId,
          {
            MaXe: nextVehicle,
            MaDVT: nextCarrier,
            UpdatedAt: formatDateTimeVN(),
            UpdatedBy: user.email,
          },
          y
        );
        if (updated < 0) {
          await appendSheetRow(
            SHEETS.CT_VT,
            {
              ID_Chitiet: detailId,
              MaXe: nextVehicle,
              MaDVT: nextCarrier,
              UpdatedAt: formatDateTimeVN(),
              UpdatedBy: user.email,
            },
            y
          ).catch(() => undefined);
        }
      } else if (
        payload.transportTypeId !== undefined ||
        payload.carrierId !== undefined
      ) {
        // Không thuê / bỏ ĐVT → clear MaDVT trên CT_VT nếu còn dòng
        await updateSheetRowByKey(
          SHEETS.CT_VT,
          "ID_Chitiet",
          detailId,
          {
            MaXe: nextVehicle,
            MaDVT: "",
            UpdatedAt: formatDateTimeVN(),
            UpdatedBy: user.email,
          },
          y
        ).catch(() => -1);
      }
    } catch (e) {
      console.error("[DetailService.updateDetail] CT_VT sync failed", e);
      throw {
        code: "PARTIAL_WRITE",
        message:
          "Đã lưu chi tiết xe nhưng ghi DonHang_VanTai (ĐVT) thất bại. Vui lòng lưu lại.",
      };
    }

    let resendMarked = false;
    let changedFields: string[] = [];
    if (changed.length && oldCt.orderId) {
      const order = await OrderRepository.findById(oldCt.orderId, y);
      const action = changed.includes("Số lượng kế hoạch")
        ? "DETAIL_MASTER_OR_PLAN_QTY_CHANGED"
        : "DETAIL_MASTER_CHANGED";
      const mark = await markOrderResendIfSent({
        orderId: oldCt.orderId,
        order,
        email: user.email,
        role: user.role,
        action,
        changedFields: changed,
        oldValue: {
          MaXe: oldCt.vehicleId,
          MaHH: oldCt.productId,
          Khuvuc: oldCt.regionId,
          GhiChu: oldCt.note,
          SoLuong: oldCt.quantity,
          MaHTVT: oldCt.transportTypeId,
          MaDVT: oldCarrierId,
        },
        newValue: {
          MaXe: payload.vehicleId ?? oldCt.vehicleId,
          MaHH: payload.productId ?? oldCt.productId,
          Khuvuc: payload.regionId ?? oldCt.regionId,
          GhiChu: payload.note ?? oldCt.note,
          SoLuong:
            payload.quantity !== undefined
              ? qty3(Number(payload.quantity) || 0)
              : oldCt.quantity,
          MaHTVT: payload.transportTypeId ?? oldCt.transportTypeId,
          MaDVT: payload.carrierId !== undefined ? nextCarrier : oldCarrierId,
        },
        year: y,
      });
      resendMarked = mark.marked;
      changedFields = mark.changedFields;
    }

    return {
      detailId,
      ...payload,
      row,
      resendMarked,
      changedFields,
    };
  }
}
