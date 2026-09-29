/**
 * Thêm nhanh ĐVT / Xe — parity V21 quickAddTransportUnit / quickAddVehicle
 */
import { hasPermission } from "@/lib/auth";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { appendSheetRow, readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";
import { writeAudit } from "@/lib/sheets/audit";
import {
  formatPhoneVn,
  normalizeNameForDup,
  normalizePlate,
  normalizeVehicleText,
  suggestCodeFromName,
  uniqueCodeFromUsed,
  vehicleCodePrefix,
} from "@/lib/master-codes";
import type { UserContext } from "@/types";

function canQuickAdd(user: UserContext): boolean {
  return (
    hasPermission(user, "*") ||
    hasPermission(user, "MASTER_UPDATE") ||
    hasPermission(user, "ORDER_UPDATE") ||
    ["ADMIN", "MANAGER", "PURCHASE", "DISPATCHER"].includes(
      String(user.role || "").toUpperCase()
    )
  );
}

export class MasterQuickService {
  /** V21 quickAddTransportUnit */
  static async quickAddDvt(
    payload: {
      tenDVT: string;
      dienThoai?: string;
      diaChi?: string;
      mst?: string;
      nguoiLienHe?: string;
      ghiChu?: string;
    },
    user: UserContext
  ) {
    if (!canQuickAdd(user)) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền thêm ĐVT" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
    }
    const tenDVT = String(payload.tenDVT || "").trim();
    if (!tenDVT) {
      throw { code: "VALIDATION_ERROR", message: "Vui lòng nhập tên đơn vị vận tải." };
    }
    const norm = normalizeNameForDup(tenDVT);
    const rows = await readSheetAsObjects(SHEETS.DVT, {});
    const existed = rows.find(
      (r) => normalizeNameForDup(String(r.TenDVT || "")) === norm
    );
    if (existed) {
      throw {
        code: "DUPLICATE",
        message:
          "Đơn vị vận tải đã tồn tại: " +
          (String(existed.TenDVT || existed.MaDVT || "").trim() || tenDVT),
        item: {
          id: String(existed.MaDVT || "").trim(),
          name: String(existed.TenDVT || existed.MaDVT || "").trim(),
          raw: existed,
        },
      };
    }
    const used = new Set<string>();
    rows.forEach((r) => {
      const k = String(r.MaDVT || "").trim().toUpperCase();
      if (k) used.add(k);
    });
    const base = suggestCodeFromName(tenDVT, "DVT");
    const maDVT = uniqueCodeFromUsed(base, used);
    const row = {
      MaDVT: maDVT,
      TenDVT: tenDVT,
      Dienthoai: formatPhoneVn(payload.dienThoai || ""),
      Diachi: String(payload.diaChi || "").trim(),
      MST: String(payload.mst || "").trim(),
      NguoiLienHe: String(payload.nguoiLienHe || "").trim(),
      HoatDong: true,
      Ghichu: String(payload.ghiChu || "").trim(),
    };
    await appendSheetRow(SHEETS.DVT, row);
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "QUICK_ADD_DVT",
      targetId: maDVT,
      newValue: JSON.stringify(row),
    }).catch(() => {});
    return {
      id: maDVT,
      name: tenDVT,
      raw: row as unknown as Record<string, string>,
    };
  }

  /** V21 quickAddVehicle */
  static async quickAddVehicle(
    payload: {
      bienSo: string;
      maHTVT: string;
      maDVT?: string;
      soMooc?: string;
      tenLaiXe?: string;
      bangLai?: string;
      ghiChu?: string;
    },
    user: UserContext
  ) {
    if (!canQuickAdd(user)) {
      throw { code: "PERMISSION_DENIED", message: "Không có quyền thêm xe" };
    }
    if (!isSheetsConfigured()) {
      throw { code: "SHEETS_NOT_CONFIGURED", message: "Chưa cấu hình Sheets" };
    }
    const bienSo = String(payload.bienSo || "").trim();
    const maHTVT = String(payload.maHTVT || "").trim();
    const maDVT = String(payload.maDVT || "").trim();
    if (!bienSo) {
      throw { code: "VALIDATION_ERROR", message: "Vui lòng nhập biển số xe." };
    }
    if (!maHTVT) {
      throw { code: "VALIDATION_ERROR", message: "Thiếu hình thức vận tải." };
    }
    const isThue =
      maHTVT.toUpperCase() === "THUE_NGOAI" ||
      maHTVT.toUpperCase().includes("THUE");
    if (isThue && !maDVT) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Xe thuê ngoài bắt buộc có đơn vị vận tải.",
      };
    }

    const [htvtRows, dvtRows, xeRows] = await Promise.all([
      readSheetAsObjects(SHEETS.HTVT, {}),
      readSheetAsObjects(SHEETS.DVT, {}),
      readSheetAsObjects(SHEETS.XE, {}),
    ]);
    const htvt = htvtRows.find(
      (r) =>
        String(r.MaHTVT || "").trim().toUpperCase() === maHTVT.toUpperCase()
    );
    if (!htvt) {
      throw { code: "VALIDATION_ERROR", message: "Hình thức vận tải không tồn tại." };
    }
    let dvt: Record<string, string> | undefined;
    if (isThue) {
      dvt = dvtRows.find(
        (r) =>
          String(r.MaDVT || "").trim().toUpperCase() === maDVT.toUpperCase()
      );
      if (!dvt) {
        throw { code: "VALIDATION_ERROR", message: "Đơn vị vận tải không tồn tại." };
      }
    }

    const plateNorm = normalizePlate(bienSo);
    if (!plateNorm) {
      throw { code: "VALIDATION_ERROR", message: "Biển số xe không hợp lệ." };
    }
    const soMooc = String(payload.soMooc || "").trim();
    const tenLaiXe = String(payload.tenLaiXe || "").trim();
    const bangLai = String(payload.bangLai || "").trim();

    const sameIdentity = (r: Record<string, string>) =>
      normalizePlate(String(r.BienSoXe || r.BienSo || "")) === plateNorm &&
      normalizeVehicleText(String(r.SoMooc || "")) ===
        normalizeVehicleText(soMooc) &&
      normalizeVehicleText(String(r.Tenlaixe || "")) ===
        normalizeVehicleText(tenLaiXe) &&
      normalizeVehicleText(String(r.Banglai || "")) ===
        normalizeVehicleText(bangLai) &&
      String(r.MaDVT || "").trim() === (isThue ? maDVT : "");

    const existed = xeRows.find(sameIdentity);
    if (existed) {
      const oldPlate = String(existed.BienSoXe || "").trim();
      const oldMooc = String(existed.SoMooc || "").trim();
      const display = oldMooc ? `${oldPlate}/${oldMooc}` : oldPlate;
      throw {
        code: "DUPLICATE",
        message: "Xe cùng biển số/mooc/lái xe/bằng lái đã tồn tại: " + display,
        item: {
          id: String(existed.MaXe || "").trim(),
          name: display,
          raw: existed,
        },
      };
    }

    // MaXe = prefix + plate + sequential 01,02…
    const prefix = vehicleCodePrefix(maHTVT);
    const fullBase = prefix + plateNorm;
    let maxNo = 0;
    for (const r of xeRows) {
      const ma = String(r.MaXe || "").trim().toUpperCase();
      if (!ma.startsWith(fullBase.toUpperCase())) continue;
      const suffix = ma.slice(fullBase.length);
      if (/^\d+$/.test(suffix)) maxNo = Math.max(maxNo, Number(suffix));
    }
    const maXe = fullBase + String(maxNo + 1).padStart(2, "0");

    const tenHTVT = String(htvt.TenHTVT || maHTVT).trim();
    const tenDVT = isThue
      ? String(dvt?.TenDVT || maDVT).trim()
      : "";
    const row = {
      MaXe: maXe,
      BienSoXe: bienSo.toUpperCase(),
      Tenlaixe: tenLaiXe,
      SoMooc: soMooc,
      Banglai: bangLai,
      Ghichu: String(payload.ghiChu || "").trim(),
      MaHTVT: maHTVT,
      TenHTVT: tenHTVT,
      MaDVT: isThue ? maDVT : "",
      TenDVT: isThue ? tenDVT : "",
      HoatDong: true,
    };
    await appendSheetRow(SHEETS.XE, row);

    const sub = [
      soMooc ? "Mooc: " + soMooc : "",
      tenLaiXe,
      bangLai,
      tenHTVT,
      tenDVT,
    ]
      .filter(Boolean)
      .join(" - ");
    const displayPlate = soMooc
      ? `${row.BienSoXe}/${soMooc}`
      : row.BienSoXe;
    const label = [displayPlate, sub].filter(Boolean).join(" | ");

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "QUICK_ADD_XE",
      targetId: maXe,
      newValue: JSON.stringify(row),
    }).catch(() => {});

    return {
      id: maXe,
      name: label,
      raw: row as unknown as Record<string, string>,
    };
  }
}
