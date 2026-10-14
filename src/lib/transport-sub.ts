/**
 * Ghi chú Hình thức vận tải hiển thị dưới biển số (tab Chi tiết + Giao hàng).
 * Chỉ dùng để hiển thị — không ảnh hưởng nghiệp vụ.
 *
 * Thuê ngoài: kèm tên Đơn vị vận tải (DM_Xe.MaDVT → DM_DonViVanTai.TenDVT).
 */
export function transportSub(d: {
  transportTypeName?: string;
  transportTypeId?: string;
  /** TenDVT hoặc MaDVT */
  carrierName?: string;
  carrierId?: string;
}): string {
  const rawName = String(d.transportTypeName || "").trim();
  const rawId = String(d.transportTypeId || "").trim();
  const t = (rawName || rawId).toLowerCase();
  const carrier = String(d.carrierName || d.carrierId || "").trim();

  const isThue =
    t.includes("thuê") ||
    t.includes("thue") ||
    rawId.toUpperCase() === "THUE_NGOAI" ||
    rawId.toUpperCase().includes("THUE");

  if (t.includes("npp") || t.includes("nhà phân") || t.includes("nha phan")) {
    return "NPP vận chuyển";
  }
  if (t.includes("khách") || t.includes("khach") || /\bkh\b/.test(t)) {
    return "KH vận chuyển";
  }
  if (t.includes("ncc")) {
    return "NCC vận chuyển";
  }
  if (isThue) {
    return carrier ? `Thuê ngoài — ${carrier}` : "Thuê ngoài";
  }
  // HTVT khác: hiện tên; nếu vẫn có carrier (hiếm) thì ghép
  if (rawName) {
    return carrier && !rawName.toLowerCase().includes(carrier.toLowerCase())
      ? `${rawName} — ${carrier}`
      : rawName;
  }
  return rawId || "";
}
