/**
 * Parity V21 `_resolveDonGiaMua_`:
 * - MaNCC + MaHH + HoatDong
 * - TuNgay <= ngayNhan
 * - Ưu tiên Makv khớp exact; không có thì Makv rỗng
 * - TuNgay mới nhất
 * Makv lấy từ CT.Khuvuc (hoặc Makv) — V21 `_ctMakv_`
 */
export type GiaMuaRow = {
  idGia?: string;
  maNcc: string;
  maHh: string;
  makv: string;
  donGia: number;
  tuNgay: string;
  active: boolean;
};

export type ResolveGiaResult = {
  found: boolean;
  donGia: number;
  idGia: string;
  makvMatched: string;
};

function ymd(s: string): string {
  return String(s || "").trim().slice(0, 10);
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

  const exact = kv ? candidates.filter((r) => r.makv === kv) : [];
  const fallback = candidates.filter((r) => !r.makv);
  const pool = exact.length ? exact : fallback;
  if (!pool.length) {
    return { found: false, donGia: 0, idGia: "", makvMatched: "" };
  }

  pool.sort((a, b) => ymd(b.tuNgay).localeCompare(ymd(a.tuNgay)));
  const best = pool[0];
  return {
    found: true,
    donGia: Number(best.donGia) || 0,
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
    activeRaw === "không"
  );
  let tuNgay = String(r.TuNgay || "").trim();
  if (/^\d+(\.\d+)?$/.test(tuNgay)) {
    const n = Number(tuNgay);
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + n * 86400000);
    tuNgay = d.toISOString().slice(0, 10);
  } else {
    tuNgay = tuNgay.slice(0, 10);
  }
  return {
    idGia: String(r.ID_Gia || "").trim(),
    maNcc,
    maHh,
    makv: String(r.Makv || r.MaKV || "").trim(),
    donGia: Number(r.DonGia) || 0,
    tuNgay,
    active,
  };
}
