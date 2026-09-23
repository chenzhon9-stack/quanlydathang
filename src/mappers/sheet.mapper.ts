import type {
  Order,
  OrderStatus,
  OrderDetail,
  Delivery,
  ProductionPlan,
  Payable,
  OpeningBalance,
  DetailStatus,
  PhanLoaiHH,
} from "@/types";
import { normalizeSheetDate } from "@/lib/sheets/date";
import { parseNumberVN } from "@/lib/parse";

function num(v: string | undefined): number {
  return parseNumberVN(v);
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== "") return row[k];
  }
  return "";
}



/** Map DonHang row → Order (skill Schema: MaDon, NgayDatHang, MaNCC, …) */
export function mapOrderRow(row: Record<string, string>): Order {
  const statusRaw = pick(row, [
    "TrangThaiDon",
    "TrangThai",
    "STATUS",
    "status",
  ]);
  const statusMap: Record<string, OrderStatus> = {
    "Khởi tạo": "NEW",
    "Mới tạo": "NEW",
    "Đang xử lý": "PROCESSING",
    "Đã gửi": "PROCESSING",
    "Hoàn thành": "DONE",
    "Hủy đơn": "CANCEL",
    "Hủy": "CANCEL",
    NEW: "NEW",
    PROCESSING: "PROCESSING",
    DONE: "DONE",
    CANCEL: "CANCEL",
  };

  const boolish = (v: string) => {
    const s = v.toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "x";
  };

  return {
    orderId: pick(row, ["MaDon", "Ma_Don", "orderId", "MADON"]),
    orderDate: normalizeSheetDate(
      pick(row, ["NgayDatHang", "NgayDat", "orderDate", "NGAYDATHANG"])
    ),
    supplierId: pick(row, ["MaNCC", "Ma_NCC", "supplierId", "MANCC"]),
    supplierName:
      pick(row, ["TenNCC", "Ten_NCC", "supplierName", "TENNCC"]) || undefined,
    sendCount: num(pick(row, ["LanGui", "SoLanGui", "sendCount"])),
    status: statusMap[statusRaw] || (statusRaw as OrderStatus) || "NEW",
    detailCount: num(
      pick(row, ["TongSoChitiet", "SoChiTiet", "detailCount", "TongCT"])
    ),
    cancelledDetailCount: num(
      pick(row, ["ChitietHuy", "SoCTHuy", "cancelledDetailCount"])
    ),
    orderFile:
      pick(row, ["FileDonhang", "FilePDF", "orderFile", "PDF"]) || undefined,
    pendingMail: boolish(pick(row, ["ChoGuiMail", "pendingMail", "ChoGui"])),
    mailSentAt:
      pick(row, ["timeGuimail", "TimeGuiMail", "mailSentAt"]) || undefined,
    resendMail: boolish(pick(row, ["GuiLaimail", "GuiLaiMail", "resendMail"])),
    createdBy: pick(row, ["User", "NguoiTao", "Email", "createdBy", "USER"]),
  };
}

/** Map DonHang_Chitiet row → OrderDetail (receiving report) */
export function mapDetailRow(row: Record<string, string>): OrderDetail {
  const statusRaw = pick(row, [
    "TrangThaiXe",
    "TrangThai",
    "TrangThaiCT",
    "STATUS_CT",
    "status",
  ]);
  const statusMap: Record<string, DetailStatus> = {
    "Mới tạo": "NEW",
    "Khởi tạo": "NEW",
    "Đặt hàng": "ORDERED",
    "Đã nhận": "RECEIVED",
    "Đang giao": "DELIVERING",
    "Hoàn thành": "DONE",
    "Hủy xe": "CANCEL",
    "Hủy": "CANCEL",
    "Xóa xe": "DELETE",
    NEW: "NEW",
    ORDERED: "ORDERED",
    RECEIVED: "RECEIVED",
    DELIVERING: "DELIVERING",
    DONE: "DONE",
    CANCEL: "CANCEL",
    DELETE: "DELETE",
  };

  const phanLoai = pick(row, ["PhanLoaiHH", "PHANLOAI_HH", "PhanLoai"]);
  let pl: PhanLoaiHH | undefined;
  if (phanLoai === "Bao" || phanLoai === "Roi" || phanLoai === "Khac") {
    pl = phanLoai;
  }

  return {
    detailId: pick(row, ["ID_Chitiet", "IdChitiet", "ID_CT", "detailId"]),
    orderId: pick(row, ["MaDon", "Ma_Don", "orderId"]),
    orderDate: normalizeSheetDate(pick(row, ["NgayDatHang", "NgayDat", "orderDate"])),
    supplierId: pick(row, ["MaNCC", "Ma_NCC", "supplierId"]),
    vehicleId: pick(row, ["MaXe", "BienSo", "vehicleId"]),
    productId: pick(row, ["MaHH", "Ma_HH", "productId"]),
    productName: pick(row, ["TenHH", "TenHangHoa", "productName"]) || undefined,
    quantity: num(pick(row, ["SoLuong", "SL", "quantity"])),
    regionId: pick(row, ["Khuvuc", "Makv", "MaKV", "KhuVuc", "regionId"]),
    warehouse: pick(row, ["KhoXuat", "Kho", "warehouse"]) || undefined,
    note: pick(row, ["Ghichu", "GhiChu", "note"]) || undefined,
    status: statusMap[statusRaw] || (statusRaw as DetailStatus) || "NEW",
    receivedDate:
      normalizeSheetDate(pick(row, ["NgayNhanHang", "NgayNhan", "receivedDate"])) || undefined,
    actualReceived: (() => {
      const v = pick(row, ["ThucNhan", "SLNhan", "actualReceived"]);
      return v ? num(v) : undefined;
    })(),
    transportTypeId: pick(row, ["MaHTVT", "HTVT"]) || undefined,
    transportTypeName: pick(row, ["TenHTVT"]) || undefined,
    isDuyenHa: pick(row, ["IsDuyenHa"]).toLowerCase() === "true" || pick(row, ["IsDuyenHa"]) === "1",
    phanLoai: pl,
  };
}

/** Map Chitiet_Giaohang row → Delivery */
export function mapDeliveryRow(row: Record<string, string>): Delivery {
  return {
    deliveryId: pick(row, ["ID_Giaohang", "IdGiaohang", "ID_GH", "deliveryId"]),
    detailId: pick(row, ["ID_Chitiet", "IdChitiet", "detailId"]),
    customerId: pick(row, ["MaKh", "MaKH", "MaKhachHang", "customerId"]),
    customerName:
      pick(row, ["TenKh", "TenKH", "TenKhachHang", "customerName"]) ||
      undefined,
    customerDetail: pick(row, ["ChitietKh", "ChiTietKH", "customerDetail"]) || undefined,
    plannedQty: num(pick(row, ["KHgiao", "SoLuongKH", "SLKH", "SoLuong", "plannedQty"])),
    actualQty: (() => {
      const v = pick(row, ["ThucGiao", "SLGiao", "actualQty"]);
      return v ? num(v) : undefined;
    })(),
    deliveryDate:
      normalizeSheetDate(pick(row, ["Ngaygiao", "NgayGiao", "NgayGiaoHang", "deliveryDate"])) || undefined,
    note: pick(row, ["Ghichu", "GhiChu", "note"]) || undefined,
    deleted:
      pick(row, ["Xoa", "Deleted", "IsDeleted"]).toLowerCase() === "true" ||
      pick(row, ["Xoa", "Deleted"]) === "1",
  };
}

/** Map KHSANLUONG row → ProductionPlan */
export function mapPlanRow(row: Record<string, string>): ProductionPlan {
  return {
    id: pick(row, ["ID_KeHoach", "IdKeHoach", "MaKH", "id"]),
    programName: pick(row, [
      "Tenchuongtrinh",
      "TenChuongTrinh",
      "ChuongTrinh",
      "TenKH",
      "programName",
    ]),
    supplierId: pick(row, ["MaNCC", "Ma_NCC", "supplierId"]),
    supplierName:
      pick(row, ["TenNCC", "Ten_NCC", "supplierName"]) || undefined,
    productIds: pick(row, ["MaHH", "DanhSachHH", "productIds"])
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean),
    fromDate: normalizeSheetDate(pick(row, ["TuNgay", "FromDate", "fromDate"])),
    toDate: normalizeSheetDate(pick(row, ["DenNgay", "ToDate", "toDate"])),
    plannedQuantity: num(
      pick(row, ["SoLuongKeHoach", "KeHoach", "SanLuongKH", "plannedQuantity"])
    ),
    actualQuantity: num(
      pick(row, ["ThucTe", "ThucHien", "SanLuongTH", "actualQuantity"])
    ),
    status: pick(row, ["TrangThai", "Status", "status"]) || "Đang thực hiện",
    note: pick(row, ["GhiChu", "note"]) || undefined,
    createdBy: pick(row, ["User", "NguoiTao", "createdBy"]) || "",
    createdAt: pick(row, ["CreatedAt", "NgayTao", "createdAt"]) || "",
  };
}

/** Map NCC_CongNo row → Payable */
export function mapPayableRow(row: Record<string, string>): Payable {
  const typeRaw = pick(row, ["Loai", "LoaiPS", "Type", "type"]);
  const typeMap: Record<string, Payable["type"]> = {
    THANH_TOAN: "THANH_TOAN",
    "Thanh toán": "THANH_TOAN",
    CHIET_KHAU: "CHIET_KHAU",
    "Chiết khấu": "CHIET_KHAU",
    DOI_TRU: "DOI_TRU",
    "Đối trừ": "DOI_TRU",
    DIEU_CHINH_GIAM: "DIEU_CHINH_GIAM",
    "Điều chỉnh giảm": "DIEU_CHINH_GIAM",
    DIEU_CHINH_TANG: "DIEU_CHINH_TANG",
    "Điều chỉnh tăng": "DIEU_CHINH_TANG",
  };

  return {
    id: pick(row, ["ID_CN", "IdCN", "id"]),
    date: normalizeSheetDate(pick(row, ["NgayCT", "Ngay", "NgayPS", "date"])),
    supplierId: pick(row, ["MaNCC", "Ma_NCC", "supplierId"]),
    supplierName:
      pick(row, ["TenNCC", "Ten_NCC", "supplierName"]) || undefined,
    type: typeMap[typeRaw] || "THANH_TOAN",
    amount: num(pick(row, ["SoTien", "Amount", "amount"])),
    productId: pick(row, ["MaHH", "productId"]) || undefined,
    regionId: pick(row, ["Makv", "regionId"]) || undefined,
    detailId: pick(row, ["ID_Chitiet", "detailId"]) || undefined,
    documentNo: pick(row, ["SoChungTu", "documentNo"]) || undefined,
    description: pick(row, ["DienGiai", "MoTa", "GhiChu", "description"]) || undefined,
    createdBy: pick(row, ["User", "NguoiTao", "createdBy"]) || "",
    createdAt: pick(row, ["CreatedAt", "NgayTao", "createdAt"]) || "",
    active:
      pick(row, ["HoatDong", "Active", "active"]).toLowerCase() !== "false" &&
      pick(row, ["HoatDong", "Active"]) !== "0",
  };
}

/** Map NCC_DuDauNam row → OpeningBalance */
export function mapOpeningRow(row: Record<string, string>): OpeningBalance {
  return {
    id: pick(row, ["ID_DD", "IdDD", "id"]),
    year: num(pick(row, ["Nam", "Year", "year"])) || new Date().getFullYear(),
    supplierId: pick(row, ["MaNCC", "Ma_NCC", "supplierId"]),
    supplierName:
      pick(row, ["TenNCC", "Ten_NCC", "supplierName"]) || undefined,
    openingAmount: num(pick(row, ["SoDuDau", "SoTien", "DuDau", "openingAmount"])),
    note: pick(row, ["GhiChu", "note"]) || undefined,
    closedBy: pick(row, ["NguoiChot", "closedBy"]) || undefined,
    closedAt: pick(row, ["NgayChot", "closedAt"]) || undefined,
    active:
      pick(row, ["HoatDong", "Active"]).toLowerCase() !== "false" &&
      pick(row, ["HoatDong", "Active"]) !== "0",
  };
}
