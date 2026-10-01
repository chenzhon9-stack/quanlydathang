import { normalizeSheetDate } from "@/lib/sheets/date";
import { parseNumberVN } from "@/lib/parse";

/** Parity V21 `_resolveDonGiaMua_` */
export type GiaMuaRow = {
  idGia?: string;
  maNcc: string;
  maHh: string;
  makv: string;
  donGia: number;
  tuNgay: string;
  active: boolean;
  ghiChu?: string;
};

export type ResolveGiaResult = {
  found: boolean;
  donGia: number;
  idGia: string;
  makvMatched: string;
};

function ymd(s: string): string {
  return normalizeSheetDate(s) || String(s || "").trim().slice(0, 10);
}

export function resolveDonGiaMua(
  prices: GiaMuaRow[],
  maNcc: string,
  maHh: string,
  makv: string,
  ngayNhan: string
): ResolveGiaResult {
  const ncc = String(maNcc || "").trim();
  const hh = String(maHh || "").trim();
  const kv = String(makv || "").trim();
  const day = ymd(ngayNhan);
  if (!ncc || !hh || !day) {
    return { found: false, donGia: 0, idGia: "", makvMatched: "" };
  }

  const candidates = prices.filter((r) => {
    if (!r.active) return false;
    if (r.maNcc !== ncc || r.maHh !== hh) return false;
    const tu = ymd(r.tuNgay);
    return !!tu && tu <= day;
  });

  if (!candidates.length) {
    return { found: false, donGia: 0, idGia: "", makvMatched: "" };
  }

  // V21 _resolveDonGiaMua_: exact Makv > Makv rỗng — KHÔNG fallback mọi Makv
  const exact = kv ? candidates.filter((r) => r.makv === kv) : [];
  const fallback = candidates.filter((r) => !r.makv);
  const pool = exact.length ? exact : fallback;
  if (!pool.length) {
    return { found: false, donGia: 0, idGia: "", makvMatched: "" };
  }

  pool.sort((a, b) => ymd(b.tuNgay).localeCompare(ymd(a.tuNgay)));
  const best = pool[0];
  // donGia=0 hợp lệ (mốc KM); không dùng || 0 vì 0 là falsy
  const gia = Number(best.donGia);
  return {
    found: true,
    donGia: Number.isFinite(gia) ? gia : 0,
    idGia: best.idGia || "",
    makvMatched: best.makv || "",
  };
}

export function mapGiaMuaSheetRow(r: Record<string, string>): GiaMuaRow | null {
  const maNcc = String(r.MaNCC || "").trim();
  const maHh = String(r.MaHH || "").trim();
  if (!maNcc || !maHh) return null;
  const activeRaw = String(r.HoatDong ?? "true").toLowerCase();
  const active = !(
  	activeRaw === "false" ||
  	activeRaw === "0" ||
 	 activeRaw === "không" ||
  	activeRaw === "no"
  );
  return {
    idGia: String(r.ID_Gia || "").trim(),
    maNcc,
    maHh,
    makv: String(r.Makv || r.MaKV || r.Khuvuc || "").trim(),
    donGia: parseNumberVN(r.DonGia),
    tuNgay: normalizeSheetDate(r.TuNgay),
    active,
    ghiChu: String(r.GhiChu || "").trim() || undefined,
  };
}
