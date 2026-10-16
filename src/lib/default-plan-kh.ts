/**
 * KH mặc định khi chưa xác định nơi giao (parity vận hành Viết Hải):
 * - Xi măng Bao  → acghangB
 * - Xi măng Rời  → acghangR
 * - Khác / trống → acghang (tương thích dữ liệu cũ)
 */

export type DefaultPlanKh = { id: string; name: string };

export function normalizePhanLoai(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

/** Lấy PhanLoaiHH từ object master HH (raw picker / sheet row). */
export function phanLoaiFromMasterRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  return String(
    r.PhanLoaiHH ?? r.PhanLoai ?? r.phanLoai ?? r.phanloai ?? ""
  ).trim();
}

/**
 * Map phân loại hàng → mã KH buffer.
 * Nhận diện: chứa "bao" trong chuỗi; rời = "roi" sau khi bỏ dấu.
 */
export function defaultPlanKhFromPhanLoai(phanLoai: unknown): DefaultPlanKh {
  const p = normalizePhanLoai(phanLoai);
  if (p.includes("bao")) {
    return { id: "acghangB", name: "acghangB" };
  }
  if (p.includes("roi")) {
    return { id: "acghangR", name: "acghangR" };
  }
  return { id: "acghang", name: "acghang" };
}

/** Dòng KH buffer (chưa chốt nơi giao) — gồm mã cũ + B/R. */
export function isAcghangBufferKh(
  customerId: string | null | undefined
): boolean {
  const k = String(customerId ?? "")
    .trim()
    .toLowerCase();
  if (!k) return true;
  return k === "acghang" || k === "acghangb" || k === "acghangr";
}

/** Ưu tiên buffer khớp phân loại khi rút/đẩy KHgiao. */
export function preferredBufferKhId(phanLoai: unknown): string {
  return defaultPlanKhFromPhanLoai(phanLoai).id;
}

/**
 * Khi lưu Sheet: nếu MaKh đúng "acghang" (chưa B/R) → map theo PhanLoaiHH.
 * Không đổi acghangB/acghangR hay KH thật khác.
 */
export function resolveAcghangOnSave(
  customerId: string | null | undefined,
  phanLoai: unknown
): string {
  const k = String(customerId ?? "").trim();
  if (k.toLowerCase() !== "acghang") return k;
  return defaultPlanKhFromPhanLoai(phanLoai).id;
}

/** Khách đệm theo ĐÚNG mã (không coi mã trống là đệm) — dùng cho nghiệp vụ phân bổ / chặn giao thực tế. */
export function isAcghangId(customerId: string | null | undefined): boolean {
  const k = String(customerId ?? "").trim().toLowerCase();
  return k === "acghang" || k === "acghangb" || k === "acghangr";
}
