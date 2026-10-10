/**
 * Ghi chú Hình thức vận tải hiển thị dưới biển số (tab Chi tiết + Giao hàng).
 * Chỉ dùng để hiển thị — không ảnh hưởng nghiệp vụ.
 */
export function transportSub(d: {
  transportTypeName?: string;
  transportTypeId?: string;
}): string {
  const t = (d.transportTypeName || d.transportTypeId || "").toLowerCase();
  if (t.includes("npp") || t.includes("nhà phân")) return "NPP vận chuyển";
  if (t.includes("khách") || t.includes("kh ")) return "KH vận chuyển";
  if (t.includes("ncc")) return "NCC vận chuyển";
  if (t.includes("thuê")) return "Thuê ngoài";
  return d.transportTypeName || "";
}
