/**
 * Master catalog maps — enrich mã → tên (NCC, KH, HH, Xe, KV, HTVT, DVT)
 * Cache in-memory ngắn (60s) theo process instance (Vercel ok cho cold-ish).
 */
import { isSheetsConfigured } from "@/lib/sheets/client";
import { readSheetAsObjects } from "@/lib/sheets/dal";
import { SHEETS } from "@/lib/sheets/constants";

type Dict = Record<string, string>;

type CacheEntry = { at: number; map: Dict };
const cache: Record<string, CacheEntry> = {};
const TTL_MS = 60_000;

function isActive(v: unknown): boolean {
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase();
  if (["false", "0", "no", "không", "khoa", "khóa"].includes(s)) return false;
  return true;
}

async function loadMap(
  key: string,
  sheet: string,
  idKeys: string[],
  nameKeys: string[],
  onlyActive = true
): Promise<Dict> {
  const hit = cache[key];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

  if (!isSheetsConfigured()) {
    cache[key] = { at: Date.now(), map: {} };
    return {};
  }

  try {
    const rows = await readSheetAsObjects(sheet, {});
    const map: Dict = {};
    for (const r of rows) {
      if (onlyActive && r.HoatDong !== undefined && !isActive(r.HoatDong)) continue;
      let id = "";
      for (const k of idKeys) {
        if (r[k]) {
          id = String(r[k]).trim();
          break;
        }
      }
      if (!id) continue;
      let name = "";
      for (const k of nameKeys) {
        if (r[k]) {
          name = String(r[k]).trim();
          break;
        }
      }
      map[id] = name || id;
    }
    cache[key] = { at: Date.now(), map };
    console.info(`[Master] ${key} size=${Object.keys(map).length}`);
    return map;
  } catch (e) {
    console.error(`[Master] load ${key}`, e);
    return hit?.map || {};
  }
}

/** Quanly raw by master id */
async function loadQuanlyMap(
  key: string,
  sheet: string,
  idKeys: string[]
): Promise<Dict> {
  const ck = key + ":quanly";
  const hit = cache[ck];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  if (!isSheetsConfigured()) {
    cache[ck] = { at: Date.now(), map: {} };
    return {};
  }
  try {
    const rows = await readSheetAsObjects(sheet, {});
    const map: Dict = {};
    for (const r of rows) {
      let id = "";
      for (const k of idKeys) {
        if (r[k]) {
          id = String(r[k]).trim();
          break;
        }
      }
      if (!id) continue;
      if (r.HoatDong !== undefined && !isActive(r.HoatDong)) continue;
      map[id] = String(r.Quanly || r.QuanLy || "").trim();
    }
    cache[ck] = { at: Date.now(), map };
    return map;
  } catch {
    return {};
  }
}

export class MasterRepository {
  static nccNames() {
    return loadMap("ncc", SHEETS.NCC, ["MaNCC", "MaNcc"], ["TenNCC", "TenNcc"]);
  }
  static khNames() {
    return loadMap(
      "kh",
      SHEETS.KH,
      ["MaKh", "MaKH", "MaKhach"],
      ["TenKhachhang", "TenKhachHang", "TenKH"]
    );
  }
  static hhNames() {
    return loadMap(
      "hh",
      SHEETS.HH,
      ["MaHH", "MaHh"],
      ["TenHangHoa", "TenHH"]
    );
  }
  static xeNames() {
    return loadMap(
      "xe",
      SHEETS.XE,
      ["MaXe"],
      ["BienSoXe", "BienSo"],
      true
    );
  }
  static kvNames() {
    return loadMap("kv", SHEETS.KV, ["Makv", "MaKV"], ["Khuvuc", "TenKV"], false);
  }
  static htvtNames() {
    return loadMap("htvt", SHEETS.HTVT, ["MaHTVT"], ["TenHTVT"]);
  }
  static dvtNames() {
    return loadMap("dvt", SHEETS.DVT, ["MaDVT"], ["TenDVT"]);
  }

  static nccQuanly() {
    return loadQuanlyMap("ncc", SHEETS.NCC, ["MaNCC", "MaNcc"]);
  }
  static khQuanly() {
    return loadQuanlyMap("kh", SHEETS.KH, ["MaKh", "MaKH"]);
  }
  static dvtQuanly() {
    return loadQuanlyMap("dvt", SHEETS.DVT, ["MaDVT"]);
  }

  /** Full rows for master admin UI */
  static async list(type: string): Promise<Record<string, string>[]> {
    const map: Record<string, string> = {
      NCC: SHEETS.NCC,
      KH: SHEETS.KH,
      HH: SHEETS.HH,
      XE: SHEETS.XE,
      HTVT: SHEETS.HTVT,
      DVT: SHEETS.DVT,
      KV: SHEETS.KV,
      NCC_HH: SHEETS.NCC_HH,
    };
    const sheet = map[type.toUpperCase()];
    if (!sheet) return [];
    if (!isSheetsConfigured()) return [];
    return readSheetAsObjects(sheet, {});
  }
}
