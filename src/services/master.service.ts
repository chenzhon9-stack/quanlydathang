/**
 * Master CRUD — parity V21 getMasterRows / saveMasterRow / deleteMasterRow / toggleMasterRow
 */
import type { UserContext } from "@/types";
import { isAdminRole, hasPermission } from "@/lib/auth";
import {
  getMasterConfig,
  getMasterSchemaPublic,
  isMasterType,
  MasterType,
} from "@/lib/master-config";
import {
  suggestCodeFromName,
  uniqueCodeFromUsed,
  normalizePlate,
} from "@/lib/master-codes";
import { STANDARD_HEADERS, SHEETS } from "@/lib/sheets/constants";
import {
  appendSheetRow,
  readSheetAsObjects,
  updateSheetRowByKey,
} from "@/lib/sheets/dal";
import { isSheetsConfigured } from "@/lib/sheets/client";
import { writeAudit } from "@/lib/sheets/audit";
import { MasterRepository } from "@/repositories/master.repository";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function isTruthyActive(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const t = s(v).toLowerCase();
  if (!t) return true;
  if (["false", "0", "no", "không", "khoa", "khóa"].includes(t)) return false;
  return true;
}

function canWriteMaster(user: UserContext): boolean {
  if (isAdminRole(user)) return true;
  return hasPermission(user, "MASTER_UPDATE") || hasPermission(user, "*");
}

function coerceCell(
  field: string,
  val: unknown,
  fieldType?: string
): string | number | boolean {
  if (fieldType === "checkbox") {
    if (typeof val === "boolean") return val;
    const t = s(val).toLowerCase();
    return ["true", "1", "yes", "x", "có"].includes(t);
  }
  if (fieldType === "number") {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }
  return s(val);
}

export class MasterService {
  static assertType(type: string): MasterType {
    const t = s(type).toUpperCase();
    if (!isMasterType(t)) {
      throw {
        code: "VALIDATION_ERROR",
        message: `Loại danh mục không hợp lệ. Hỗ trợ: ${[
          "NCC",
          "KH",
          "HH",
          "XE",
          "HTVT",
          "DVT",
          "KV",
          "NCC_HH",
        ].join(", ")}`,
      };
    }
    return t;
  }

  static async list(typeRaw: string, user: UserContext) {
    if (!user) throw { code: "UNAUTHORIZED", message: "Chưa đăng nhập" };
    const type = this.assertType(typeRaw);
    const cfg = getMasterConfig(type)!;
    const schema = getMasterSchemaPublic(type);
    const rows = await MasterRepository.list(type);
    return {
      type,
      schema,
      headers: STANDARD_HEADERS[cfg.sheet] || cfg.displayFields,
      items: rows,
      total: rows.length,
    };
  }

  private static async validateRow(
    type: MasterType,
    row: Record<string, unknown>,
    excludeKey: string | null
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const cfg = getMasterConfig(type)!;
    const rows = await readSheetAsObjects(cfg.sheet, {});

    for (const uf of cfg.uniqueFields || []) {
      const value = s(row[uf.field]);
      if (!value) continue;
      const found = rows.some((r) => {
        if (s(r[uf.field]) !== value) return false;
        if (excludeKey && s(r[cfg.key]) === excludeKey) return false;
        return true;
      });
      if (found) return { ok: false, error: uf.error };
    }

    if (type === "NCC") {
      const email = s(row.EmailNCC);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, error: "Email NCC không hợp lệ." };
      }
    }
    if (type === "HH") {
      const pl = s(row.PhanLoaiHH);
      if (pl && !["Bao", "Roi", "Khac"].includes(pl)) {
        return {
          ok: false,
          error: "Phân loại hàng hóa không hợp lệ (chỉ Bao / Roi / Khac).",
        };
      }
    }
    if (type === "XE") {
      const maHTVT = s(row.MaHTVT);
      const maDVT = s(row.MaDVT);
      if (maHTVT === "THUE_NGOAI" && !maDVT) {
        return {
          ok: false,
          error: "Xe thuê ngoài phải chọn đơn vị vận tải.",
        };
      }
      if (!s(row.BienSoXe)) {
        return { ok: false, error: "Thiếu biển số xe." };
      }
    }
    if (type === "NCC_HH") {
      if (!s(row.MaNCC) || !s(row.MaHH)) {
        return { ok: false, error: "Thiếu MaNCC hoặc MaHH." };
      }
    }
    return { ok: true };
  }

  private static async generateKey(
    type: MasterType,
    row: Record<string, unknown>
  ): Promise<string> {
    const cfg = getMasterConfig(type)!;
    const existing = await readSheetAsObjects(cfg.sheet, {});
    const used = new Set(
      existing.map((r) => s(r[cfg.key]).toUpperCase()).filter(Boolean)
    );

    if (type === "XE") {
      const bienSo = s(row.BienSoXe);
      const maHTVT = s(row.MaHTVT) || "NPP";
      const plate = normalizePlate(bienSo) || "XE";
      // V21 VEHICLE_HTVT_PREFIX simplified: prefix by HTVT first chars
      const prefixMap: Record<string, string> = {
        NPP: "1P",
        NCC: "2C",
        THUE_NGOAI: "3T",
        KHACH: "4K",
      };
      const p = prefixMap[maHTVT] || "XE";
      const base = (p + plate).slice(0, 20).toUpperCase();
      return uniqueCodeFromUsed(base, used);
    }

    if (type === "DVT") {
      const ten = s(row.TenDVT);
      if (!ten) throw { code: "VALIDATION_ERROR", message: "Thiếu tên ĐVVT." };
      const base = suggestCodeFromName(ten, "DVT", cfg.stopWords || []);
      return uniqueCodeFromUsed(base, used);
    }

    if (type === "NCC_HH") {
      const base = `${s(row.MaNCC)}_${s(row.MaHH)}`.toUpperCase();
      return uniqueCodeFromUsed(base || "NCCHH", used);
    }

    const nameVal = s(row[cfg.nameField || ""]);
    if (!nameVal) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Thiếu tên để sinh mã.",
      };
    }
    const base = suggestCodeFromName(
      nameVal,
      cfg.prefix || "ITEM",
      cfg.stopWords || []
    );
    return uniqueCodeFromUsed(base, used);
  }

  /** Denormalize TenHTVT / TenDVT for XE when codes provided */
  private static async enrichXeNames(
    row: Record<string, unknown>
  ): Promise<void> {
    const maHTVT = s(row.MaHTVT);
    const maDVT = s(row.MaDVT);
    if (maHTVT) {
      const map = await MasterRepository.htvtNames();
      row.TenHTVT = MasterRepository.resolveName(map, maHTVT) || maHTVT;
    }
    if (maDVT) {
      const map = await MasterRepository.dvtNames();
      row.TenDVT = MasterRepository.resolveName(map, maDVT) || maDVT;
    } else {
      row.TenDVT = "";
      if (s(row.MaHTVT) !== "THUE_NGOAI") row.MaDVT = "";
    }
  }

  static async save(
    typeRaw: string,
    rowIn: Record<string, unknown>,
    user: UserContext
  ) {
    if (!canWriteMaster(user)) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Chỉ Admin hoặc quyền MASTER_UPDATE được sửa danh mục.",
      };
    }
    if (!isSheetsConfigured()) {
      throw { code: "CONFIG", message: "Chưa cấu hình Google Sheets." };
    }

    const type = this.assertType(typeRaw);
    const cfg = getMasterConfig(type)!;
    const row: Record<string, unknown> = { ...(rowIn || {}) };

    let keyValue = s(row[cfg.key]);
    if (!keyValue) {
      keyValue = await this.generateKey(type, row);
      row[cfg.key] = keyValue;
    }

    if (type === "XE") await this.enrichXeNames(row);

    const existing = await readSheetAsObjects(cfg.sheet, {});
    const found = existing.find(
      (r) => s(r[cfg.key]).toUpperCase() === keyValue.toUpperCase()
    );
    const isUpdate = !!found;

    const validate = await this.validateRow(
      type,
      row,
      isUpdate ? keyValue : null
    );
    if (!validate.ok) {
      throw { code: "VALIDATION_ERROR", message: validate.error };
    }

    const headers = STANDARD_HEADERS[cfg.sheet] || Object.keys(cfg.fieldTypes);
    const newRow: Record<string, string | number | boolean> = {};
    for (const h of headers) {
      const ft = cfg.fieldTypes[h]?.type;
      if (row[h] !== undefined && row[h] !== null) {
        newRow[h] = coerceCell(h, row[h], ft);
      } else if (isUpdate && found && found[h] !== undefined) {
        newRow[h] = coerceCell(h, found[h], ft);
      } else {
        newRow[h] = ft === "checkbox" ? true : ft === "number" ? 0 : "";
      }
    }
    if (cfg.active && (newRow[cfg.active] === "" || newRow[cfg.active] == null)) {
      newRow[cfg.active] = true;
    }

    if (isUpdate) {
      await updateSheetRowByKey(cfg.sheet, cfg.key, keyValue, newRow);
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "UPDATE_MASTER",
        source: "vercel",
        targetId: keyValue,
        oldValue: found,
        newValue: newRow,
        lyDo: `type=${type}`,
      });
    } else {
      await appendSheetRow(cfg.sheet, newRow);
      await writeAudit({
        email: user.email,
        role: user.role,
        action: "CREATE_MASTER",
        source: "vercel",
        targetId: keyValue,
        newValue: newRow,
        lyDo: `type=${type}`,
      });
    }

    MasterRepository.invalidateCache();

    return {
      mode: isUpdate ? ("update" as const) : ("insert" as const),
      key: keyValue,
      row: newRow,
      type,
    };
  }

  /** Soft-delete (HoatDong=false) hoặc hard-delete nếu không có cột active (KV) */
  static async remove(typeRaw: string, key: string, user: UserContext) {
    if (!canWriteMaster(user)) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền xóa danh mục.",
      };
    }
    const type = this.assertType(typeRaw);
    const cfg = getMasterConfig(type)!;
    const keyValue = s(key);
    if (!keyValue) {
      throw { code: "VALIDATION_ERROR", message: "Thiếu mã danh mục." };
    }

    const rows = await readSheetAsObjects(cfg.sheet, {});
    const found = rows.find(
      (r) => s(r[cfg.key]).toUpperCase() === keyValue.toUpperCase()
    );
    if (!found) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy." };
    }

    if (cfg.active) {
      await updateSheetRowByKey(cfg.sheet, cfg.key, keyValue, {
        [cfg.active]: false,
      });
    } else {
      // KV không có HoatDong — chỉ soft-mark bằng cách không hỗ trợ hard delete an toàn trên Sheets API ở đây
      throw {
        code: "VALIDATION_ERROR",
        message:
          "Danh mục KV không hỗ trợ xóa từ web. Vui lòng sửa tên hoặc xóa thủ công trên Sheet.",
      };
    }

    await writeAudit({
      email: user.email,
      role: user.role,
      action: "DELETE_MASTER",
      source: "vercel",
      targetId: keyValue,
      oldValue: found,
      lyDo: `type=${type}`,
    });
    MasterRepository.invalidateCache();
    return { success: true, key: keyValue, active: false };
  }

  static async toggle(typeRaw: string, key: string, user: UserContext) {
    if (!canWriteMaster(user)) {
      throw {
        code: "PERMISSION_DENIED",
        message: "Không có quyền đổi trạng thái danh mục.",
      };
    }
    const type = this.assertType(typeRaw);
    const cfg = getMasterConfig(type)!;
    if (!cfg.active) {
      throw {
        code: "VALIDATION_ERROR",
        message: "Danh mục này không có cột hoạt động.",
      };
    }
    const keyValue = s(key);
    const rows = await readSheetAsObjects(cfg.sheet, {});
    const found = rows.find(
      (r) => s(r[cfg.key]).toUpperCase() === keyValue.toUpperCase()
    );
    if (!found) {
      throw { code: "NOT_FOUND", message: "Không tìm thấy." };
    }
    const current = isTruthyActive(found[cfg.active]);
    const next = !current;
    await updateSheetRowByKey(cfg.sheet, cfg.key, keyValue, {
      [cfg.active]: next,
    });
    await writeAudit({
      email: user.email,
      role: user.role,
      action: "TOGGLE_MASTER",
      source: "vercel",
      targetId: keyValue,
      oldValue: String(current),
      newValue: String(next),
      lyDo: `type=${type}`,
    });
    MasterRepository.invalidateCache();
    return { success: true, key: keyValue, active: next };
  }
}
