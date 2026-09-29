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

type HhMeta = { phanLoai: string; tyleChiahet: number; ten?: string };
type HhMetaCacheEntry = { at: number; map: Record<string, HhMeta> };
const hhMetaCache: { entry?: HhMetaCacheEntry } = {};

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
      // alias uppercase để tra cứu nhanh
      const up = id.toUpperCase();
      if (up !== id && !map[up]) map[up] = name || id;
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
      ["MaHH", "MaHh", "mahh"],
      ["TenHangHoa", "TenHH", "TenHang"],
      false // lấy cả HH tạm khóa để map tên trên KHSL
    );
  }

  /**
   * Meta HH: PhanLoaiHH + TyleChiahet (cho nhận hàng khóa Bao / chia hết).
   * key = MaHH (và uppercase).
   */
  static async hhMeta(): Promise<Record<string, HhMeta>> {
    const hit = hhMetaCache.entry;
    if (hit && Date.now() - hit.at < TTL_MS) return hit.map;

    const out: Record<string, HhMeta> = {};
    if (!isSheetsConfigured()) {
      hhMetaCache.entry = { at: Date.now(), map: out };
      return out;
    }
    try {
      const rows = await readSheetAsObjects(SHEETS.HH, {});
      for (const r of rows) {
        const id = String(r.MaHH || r.MaHh || "").trim();
        if (!id) continue;
        const phanLoai = String(
          r.PhanLoaiHH || r.PhanLoai || r.phanLoai || ""
        ).trim();
        const tyleChiahet =
          Number(r.TyleChiahet || r.TyleChiaHet || r.tyleChiahet || 0) || 0;
        const ten = String(r.TenHangHoa || r.TenHH || "").trim();
        const meta: HhMeta = { phanLoai, tyleChiahet, ten };
        out[id] = meta;
        out[id.toUpperCase()] = meta;
      }
    } catch (e) {
      console.error("[Master] hhMeta", e);
    }
    hhMetaCache.entry = { at: Date.now(), map: out };
    return out;
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

  /** Tra cứu tên không phân biệt hoa thường / trim */
  static resolveName(map: Dict, id: string | undefined | null): string {
    if (!id) return "";
    const raw = String(id).trim();
    if (!raw) return "";
    if (map[raw]) return map[raw];
    const up = raw.toUpperCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.toUpperCase() === up) return v || raw;
    }
    return raw;
  }

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
    if (!isSheetsConfigured()) {
      console.warn("[MasterRepository.list] Sheets not configured");
      return [];
    }
    try {
      const rows = await readSheetAsObjects(sheet, {});
      console.info(
        `[MasterRepository.list] ${type} sheet=${sheet} rows=${rows.length}`
      );
      return rows;
    } catch (e) {
      console.error(`[MasterRepository.list] ${type} sheet=${sheet}`, e);
      // Không throw — UI hiện rỗng + log Vercel
      return [];
    }
  }
}
