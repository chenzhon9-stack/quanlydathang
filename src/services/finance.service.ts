/**
 * Finance write — parity V21 DM_GiaMua / NCC_CongNo / NCC_DuDauNam
 * - Giá mua theo mốc TuNgay (NCC+HH+Makv)
 * - Chứng từ công nợ thủ công (thanh toán / chiết khấu / đối trừ / điều chỉnh)
 * - Void chứng từ (HoatDong=false) — PAYABLE_CANCEL / Admin
 * - Chốt / ghi dư đầu năm
 */
import type { UserContext, AccessScope } from "@/types";
import { hasPermission } from "@/lib/auth";
import {
  filterBySupplierIds,
  resolveAllowedSupplierIds,
} from "@/lib/scope";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { SHEETS } from "@/lib/sheets/constants";
import {
  appendSheetRow,
  updateSheetRowByKey,
  readSheetAsObjects,
} from "@/lib/sheets/dal";
import { nextCounterCodes } from "@/lib/sheets/counter";
import {
  formatDateTimeVN,
  ymdDate,
  currentYearVN,
} from "@/lib/sheets/date";
import { writeAudit } from "@/lib/sheets/audit";
import {
  mapGiaMuaSheetRow,
  type GiaMuaRow,
} from "@/lib/finance/giamua";

/** Loại chứng từ CN thủ công (V21) */
export const PAYABLE_LOAI = [
  "THANH_TOAN",
  "CHIET_KHAU",
  "DOI_TRU",
  "DIEU_CHINH_TANG",
  "DIEU_CHINH_GIAM",
  "KHAC",
] as const;
export type PayableLoai = (typeof PAYABLE_LOAI)[number];

function requireSheets() {
  if (!isSheetsConfigured()) {
    throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
  }
}

function isActiveFlag(v: unknown): boolean {
  const s = String(v ?? "true").toLowerCase();
  return !(s === "false" || s === "0" || s === "không" || s === "no");
}

// ─── Giá mua ───────────────────────────────────────────────

export class FinanceService {
  static async listPrices(
    filter: {
      supplierId?: string;
      productId?: string;
      activeOnly?: boolean;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "PURCHASE_PRICE_VIEW") &&
      !hasPermission(user, "PAYABLE_VIEW") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem giá mua" };
    }
    requireSheets();
    const rows = await readSheetAsObjects(SHEETS.GM, {});
    let items = rows
      .map(mapGiaMuaSheetRow)
      .filter((x): x is GiaMuaRow => !!x);

    if (filter.supplierId) {
      items = items.filter((x) => x.maNcc === filter.supplierId);
    }
    if (filter.productId) {
      items = items.filter((x) => x.maHh === filter.productId);
    }
    if (filter.activeOnly !== false) {
      items = items.filter((x) => x.active);
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      if (allowed) {
        items = items.filter((x) => allowed.has(x.maNcc));
      }
    }

    items.sort((a, b) => {
      const c = a.maNcc.localeCompare(b.maNcc);
      if (c) return c;
      const h = a.maHh.localeCompare(b.maHh);
      if (h) return h;
      return (b.tuNgay || "").localeCompare(a.tuNgay || "");
    });
    return { items, total: items.length };
  }

  /**
   * Tạo hoặc cập nhật giá mua.
   * Rule V21: mỗi mốc (NCC+HH+Makv+TuNgay) — trùng → cập nhật DonGia.
   */
  static async upsertPrice(
    input: {
      idGia?: string;
      maNcc: string;
      maHh: string;
      makv?: string;
      donGia: number;
      tuNgay: string;
      ghiChu?: string;
      active?: boolean;
    },
    user: UserContext
  ) {
    if (
      !hasPermission(user, "PURCHASE_PRICE_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền cập nhật giá mua",
      };
    }
    requireSheets();
    const maNcc = String(input.maNcc || "").trim();
    const maHh = String(input.maHh || "").trim();
    const makv = String(input.makv || "").trim();
    const tuNgay = ymdDate(input.tuNgay) || "";
    const donGia = Number(input.donGia);
    if (!maNcc || !maHh) {
      throw { code: "VALIDATION_ERROR", message: "Thiếu MaNCC hoặc MaHH" };
    }
    if (!tuNgay) {
      throw { code: "VALIDATION_ERROR", message: "Thiếu Từ ngày (mốc giá)" };
    }
    if (!(donGia >= 0) || !Number.isFinite(donGia)) {
      throw { code: "VALIDATION_ERROR", message: "Đơn giá không hợp lệ" };
    }

    const now = formatDateTimeVN();
    const rows = await readSheetAsObjects(SHEETS.GM, {});
    let idGia = String(input.idGia || "").trim();

    // Tìm theo id hoặc theo khóa nghiệp vụ
    let existing = idGia
      ? rows.find((r) => String(r.ID_Gia || "").trim() === idGia)
      : undefined;
    if (!existing) {
      existing = rows.find(
        (r) =>
          String(r.MaNCC || "").trim() === maNcc &&
          String(r.MaHH || "").trim() === maHh &&
          String(r.Makv || r.MaKV || "").trim() === makv &&
          (ymdDate(r.TuNgay) || "") === tuNgay
      );
      if (existing) idGia = String(existing.ID_Gia || "").trim();
    }

    if (existing && idGia) {
      await updateSheetRowByKey(
        SHEETS.GM,
        "ID_Gia",
        idGia,
        {
          MaNCC: maNcc,
          MaHH: maHh,
          Makv: makv,
          DonGia: donGia,
          TuNgay: tuNgay,
          HoatDong: input.active !== false,
          GhiChu: input.ghiChu || existing.GhiChu || "",
          NguoiCapNhat: user.email,
          NgayCapNhat: now,
        }
      );
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "PURCHASE_PRICE_UPDATE",
        targetId: idGia,
        oldValue: {
          donGia: existing.DonGia,
          tuNgay: existing.TuNgay,
        },
        newValue: { maNcc, maHh, makv, donGia, tuNgay },
        lyDo: "Cập nhật giá mua",
      });
      return { idGia, created: false };
    }

    const codes = await nextCounterCodes("GM", tuNgay, {
      count: 1,
      email: user.email,
    });
    idGia = codes[0];
    await appendSheetRow(SHEETS.GM, {
      ID_Gia: idGia,
      MaNCC: maNcc,
      MaHH: maHh,
      Makv: makv,
      DonGia: donGia,
      TuNgay: tuNgay,
      HoatDong: true,
      GhiChu: input.ghiChu || "",
      NguoiCapNhat: user.email,
      NgayCapNhat: now,
    });
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PURCHASE_PRICE_CREATE",
      targetId: idGia,
      newValue: { maNcc, maHh, makv, donGia, tuNgay },
      lyDo: "Thêm mốc giá mua",
    });
    return { idGia, created: true };
  }

  static async deactivatePrice(idGia: string, user: UserContext) {
    if (
      !hasPermission(user, "PURCHASE_PRICE_UPDATE") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền" };
    }
    requireSheets();
    const id = String(idGia || "").trim();
    if (!id) throw { code: "VALIDATION_ERROR", message: "Thiếu ID_Gia" };
    const row = await updateSheetRowByKey(SHEETS.GM, "ID_Gia", id, {
      HoatDong: false,
      NguoiCapNhat: user.email,
      NgayCapNhat: formatDateTimeVN(),
    });
    if (row < 0) throw { code: "NOT_FOUND", message: "Không tìm thấy giá " + id };
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PURCHASE_PRICE_DEACTIVATE",
      targetId: id,
      lyDo: "Ngưng hiệu lực giá mua",
    });
    return { idGia: id, ok: true };
  }

  // ─── Công nợ chứng từ ─────────────────────────────────────

  static async createPayableEntry(
    input: {
      maNcc: string;
      loai: string;
      soTien: number;
      ngayCT?: string;
      soChungTu?: string;
      dienGiai?: string;
      maHh?: string;
      makv?: string;
      idCt?: string;
      year?: number;
    },
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "PAYABLE_CREATE") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền ghi chứng từ công nợ",
      };
    }
    requireSheets();
    const maNcc = String(input.maNcc || "").trim();
    const loai = String(input.loai || "").trim().toUpperCase();
    const soTien = Number(input.soTien);
    if (!maNcc) throw { code: "VALIDATION_ERROR", message: "Thiếu MaNCC" };
    if (!PAYABLE_LOAI.includes(loai as PayableLoai) && loai !== "THANHTOAN") {
      throw {
        code: "VALIDATION_ERROR",
        message:
          "Loại không hợp lệ. Dùng: " + PAYABLE_LOAI.join(", "),
      };
    }
    if (!Number.isFinite(soTien) || soTien === 0) {
      throw { code: "VALIDATION_ERROR", message: "Số tiền phải ≠ 0" };
    }

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      if (allowed && !allowed.has(maNcc)) {
        throw { code: "SCOPE_DENIED", message: "NCC ngoài phạm vi quản lý" };
      }
    }

    const ngayCT = ymdDate(input.ngayCT) || ymdDate(new Date()) || "";
    const y = input.year ?? Number(ngayCT.slice(0, 4)) || currentYearVN();
    const codes = await nextCounterCodes("CN", ngayCT, {
      count: 1,
      email: user.email,
      year: y,
    });
    const idCn = codes[0];
    const now = formatDateTimeVN();
    const loaiNorm =
      loai === "THANHTOAN" ? "THANH_TOAN" : loai;

    await appendSheetRow(
      SHEETS.CN,
      {
        ID_CN: idCn,
        NgayCT: ngayCT,
        MaNCC: maNcc,
        Loai: loaiNorm,
        SoTien: soTien,
        MaHH: String(input.maHh || "").trim(),
        Makv: String(input.makv || "").trim(),
        ID_Chitiet: String(input.idCt || "").trim(),
        SoChungTu: String(input.soChungTu || "").trim(),
        DienGiai: String(input.dienGiai || "").trim(),
        NguoiTao: user.email,
        NgayTao: now,
        HoatDong: true,
      },
      y
    );

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PAYABLE_CREATE",
      targetId: idCn,
      newValue: { maNcc, loai: loaiNorm, soTien, ngayCT },
      lyDo: "Ghi chứng từ công nợ",
      year: y,
    });

    return { idCn, maNcc, loai: loaiNorm, soTien, ngayCT };
  }

  /** Void — chỉ Admin / PAYABLE_CANCEL */
  static async voidPayable(
    idCn: string,
    user: UserContext,
    year?: number
  ) {
    if (
      !hasPermission(user, "PAYABLE_CANCEL") &&
      !hasPermission(user, "*") &&
      String(user.role).toUpperCase() !== "ADMIN"
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Chỉ Admin được void chứng từ công nợ",
      };
    }
    requireSheets();
    const id = String(idCn || "").trim();
    if (!id) throw { code: "VALIDATION_ERROR", message: "Thiếu ID_CN" };
    const y = year ?? currentYearVN();
    const row = await updateSheetRowByKey(
      SHEETS.CN,
      "ID_CN",
      id,
      { HoatDong: false },
      y
    );
    if (row < 0) {
      // thử không year (sheet năm hiện hành)
      const row2 = await updateSheetRowByKey(SHEETS.CN, "ID_CN", id, {
        HoatDong: false,
      });
      if (row2 < 0) {
        throw { code: "NOT_FOUND", message: "Không tìm thấy chứng từ " + id };
      }
    }
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "PAYABLE_VOID",
      targetId: id,
      lyDo: "Void chứng từ công nợ (HoatDong=false)",
      year: y,
    });
    return { idCn: id, voided: true };
  }

  // ─── Dư đầu năm ───────────────────────────────────────────

  static async listOpening(
    year: number,
    user: UserContext,
    scope: AccessScope
  ) {
    if (
      !hasPermission(user, "PAYABLE_VIEW") &&
      !hasPermission(user, "*")
    ) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền xem dư đầu năm" };
    }
    requireSheets();
    const rows = await readSheetAsObjects(SHEETS.DD, { year });
    let items = rows
      .filter((r) => String(r.ID_DD || r.MaNCC || "").trim())
      .map((r) => ({
        id: String(r.ID_DD || "").trim(),
        year: Number(r.Nam) || year,
        supplierId: String(r.MaNCC || "").trim(),
        openingAmount: Number(r.SoDuDau) || 0,
        note: String(r.GhiChu || "").trim(),
        closedBy: String(r.NguoiChot || "").trim(),
        closedAt: String(r.NgayChot || "").trim(),
        active: isActiveFlag(r.HoatDong),
      }))
      .filter((x) => x.supplierId);

    if (scope.scopeType === "MANAGEMENT") {
      const allowed = await resolveAllowedSupplierIds(scope);
      items = filterBySupplierIds(items, allowed);
    }
    return { items, year, total: items.length };
  }

  /**
   * Ghi / cập nhật dư đầu năm theo (Nam + MaNCC).
   * Chốt: set NguoiChot + NgayChot.
   */
  static async setOpeningBalance(
    input: {
      year: number;
      maNcc: string;
      soDuDau: number;
      ghiChu?: string;
      chot?: boolean;
    },
    user: UserContext
  ) {
    if (
      !hasPermission(user, "PAYABLE_CREATE") &&
      !hasPermission(user, "*")
    ) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền ghi dư đầu năm",
      };
    }
    requireSheets();
    const nam = Number(input.year) || currentYearVN();
    const maNcc = String(input.maNcc || "").trim();
    const soDuDau = Number(input.soDuDau);
    if (!maNcc) throw { code: "VALIDATION_ERROR", message: "Thiếu MaNCC" };
    if (!Number.isFinite(soDuDau)) {
      throw { code: "VALIDATION_ERROR", message: "Số dư không hợp lệ" };
    }

    const rows = await readSheetAsObjects(SHEETS.DD, { year: nam });
    const existing = rows.find(
      (r) =>
        String(r.MaNCC || "").trim() === maNcc &&
        (Number(r.Nam) || 0) === nam &&
        isActiveFlag(r.HoatDong)
    );
    const now = formatDateTimeVN();
    const patchExtra = input.chot
      ? { NguoiChot: user.email, NgayChot: now }
      : {};

    if (existing && String(existing.ID_DD || "").trim()) {
      const id = String(existing.ID_DD).trim();
      await updateSheetRowByKey(
        SHEETS.DD,
        "ID_DD",
        id,
        {
          SoDuDau: soDuDau,
          GhiChu: input.ghiChu ?? existing.GhiChu ?? "",
          HoatDong: true,
          ...patchExtra,
        },
        nam
      );
      await writeAudit({
        email: user.email,
        role: user.role,
        action: input.chot ? "OPENING_CLOSE" : "OPENING_UPDATE",
        targetId: id,
        oldValue: { soDuDau: existing.SoDuDau },
        newValue: { nam, maNcc, soDuDau, chot: !!input.chot },
        lyDo: input.chot ? "Chốt dư đầu năm" : "Cập nhật dư đầu năm",
        year: nam,
      });
      return { idDd: id, created: false, chot: !!input.chot };
    }

    const codes = await nextCounterCodes("DD", `${nam}-01-01`, {
      count: 1,
      email: user.email,
      year: nam,
    });
    const idDd = codes[0];
    await appendSheetRow(
      SHEETS.DD,
      {
        ID_DD: idDd,
        Nam: nam,
        MaNCC: maNcc,
        SoDuDau: soDuDau,
        GhiChu: input.ghiChu || "",
        NguoiChot: input.chot ? user.email : "",
        NgayChot: input.chot ? now : "",
        HoatDong: true,
      },
      nam
    );
    await writeAudit({
      email: user.email,
      role: user.role,
      action: input.chot ? "OPENING_CLOSE" : "OPENING_CREATE",
      targetId: idDd,
      newValue: { nam, maNcc, soDuDau, chot: !!input.chot },
      lyDo: input.chot ? "Chốt dư đầu năm (tạo mới)" : "Tạo dư đầu năm",
      year: nam,
    });
    return { idDd, created: true, chot: !!input.chot };
  }
}
