/**
 * Định nghĩa cột V21 — nguồn sự thật cho Chi tiết / Giao hàng / Báo cáo.
 * dimension + filterType: báo cáo group-by & header filter.
 * defaultVisible:false = cột mở rộng, ẩn mặc định.
 */
import type { ColumnDef } from "@/lib/column-prefs";

/** Chi tiết xe — parity detailsColumnDefinitions */
export const DETAILS_COLUMN_DEFS: ColumnDef[] = [
  { key: "id", label: "ID", defaultVisible: true, filterable: true },
  { key: "orderDate", label: "Ngày đặt", defaultVisible: true, filterable: true },
  { key: "plate", label: "Biển số", defaultVisible: true, filterable: true },
  { key: "product", label: "Hàng hóa", defaultVisible: true, filterable: true },
  { key: "qty", label: "KH đặt", defaultVisible: true, align: "right" },
  { key: "recvDate", label: "Ngày nhận", defaultVisible: true, filterable: true, align: "right" },
  { key: "actualRecv", label: "Thực nhận", defaultVisible: true, align: "right" },
  { key: "actualDel", label: "Thực giao", defaultVisible: true, align: "right" },
  { key: "remain", label: "Tồn", defaultVisible: true, align: "right" },
  { key: "status", label: "Trạng thái", defaultVisible: true, filterable: true },
  { key: "note", label: "Ghi chú", defaultVisible: true },
  // mở rộng
  { key: "orderId", label: "Mã đơn", defaultVisible: false, filterable: true },
  { key: "supplierId", label: "Mã NCC", defaultVisible: false, filterable: true },
  { key: "supplier", label: "Nhà cung cấp", defaultVisible: false, filterable: true },
  { key: "vehicleId", label: "Mã xe", defaultVisible: false, filterable: true },
  { key: "productId", label: "Mã hàng hóa", defaultVisible: false, filterable: true },
  { key: "regionId", label: "Mã khu vực", defaultVisible: false, filterable: true },
  { key: "region", label: "Khu vực", defaultVisible: false, filterable: true },
  { key: "htvtId", label: "Mã HTVT", defaultVisible: false, filterable: true },
  { key: "htvt", label: "Hình thức VT", defaultVisible: false, filterable: true },
  { key: "isDuyenHa", label: "Duyên Hà", defaultVisible: false, filterable: true },
  { key: "actions", label: "Hành động", defaultVisible: true },
];

/**
 * Giao hàng — parity deliveryColumnDefinitions + DEFAULT_DELIVERY_VIEW_COLUMNS
 * View mặc định V21: ngayDat, bienSo, idGh, hangHoa, ngayNhan, tenKh, khGiao, ngayGiao, thucGiao, chenhLech, trangThai
 */
export const DELIVERY_COLUMN_DEFS: ColumnDef[] = [
  { key: "orderDate", label: "Ngày đặt", defaultVisible: true, filterable: true },
  { key: "plate", label: "Biển số", defaultVisible: true, filterable: true },
  { key: "id", label: "ID Giao hàng", defaultVisible: true, filterable: true },
  { key: "product", label: "Hàng hóa", defaultVisible: true, filterable: true },
  { key: "recvDate", label: "Ngày nhận", defaultVisible: true, filterable: true },
  { key: "customer", label: "Tên khách hàng", defaultVisible: true, filterable: true },
  { key: "planned", label: "KH giao", defaultVisible: true, align: "right" },
  { key: "date", label: "Ngày giao", defaultVisible: true, filterable: true },
  { key: "actual", label: "Thực giao", defaultVisible: true, align: "right" },
  { key: "diff", label: "Chênh lệch", defaultVisible: true, align: "right" },
  { key: "status", label: "Trạng thái", defaultVisible: true, filterable: true },
  // mở rộng / export-style
  { key: "detailId", label: "ID Chi tiết", defaultVisible: false, filterable: true },
  { key: "orderId", label: "Mã đơn", defaultVisible: false, filterable: true },
  { key: "supplierId", label: "Mã NCC", defaultVisible: false, filterable: true },
  { key: "productId", label: "Mã HH", defaultVisible: false, filterable: true },
  { key: "regionId", label: "Mã khu vực", defaultVisible: false, filterable: true },
  { key: "region", label: "Tên khu vực", defaultVisible: false, filterable: true },
  { key: "customerId", label: "Mã KH", defaultVisible: false, filterable: true },
  { key: "customerDetail", label: "Chi tiết KH", defaultVisible: false },
  { key: "vehicleId", label: "Mã xe", defaultVisible: false, filterable: true },
  { key: "htvt", label: "Hình thức VT", defaultVisible: false, filterable: true },
  { key: "actualRecv", label: "Thực nhận", defaultVisible: false, align: "right" },
  { key: "actions", label: "Hành động", defaultVisible: true },
];

/** Report column meta (filterType) — đồng bộ reportColumnDefinitions V21 */
export const REPORT_COLUMN_META: Record<
  string,
  { key: string; header: string; dimension?: boolean; filterType?: string; format?: string; align?: string }[]
> = {
  thuc_nhan: [
    { key: "ncc", header: "Nhà cung cấp", dimension: true, filterType: "NCC" },
    { key: "hangHoa", header: "Hàng hóa", dimension: true, filterType: "HH" },
    { key: "phanLoai", header: "Phân loại", dimension: true, filterType: "PHANLOAI" },
    { key: "htvt", header: "Hình thức VT", dimension: true, filterType: "HTVT" },
    { key: "dvt", header: "ĐVVT", dimension: true, filterType: "DVT" },
    { key: "xe", header: "Xe", dimension: true, filterType: "XE" },
    { key: "ngayNhan", header: "Ngày nhận", dimension: true },
    { key: "thucNhan", header: "Thực nhận (tấn)", format: "num", align: "right" },
    { key: "soChuyenNhan", header: "Số chuyến", format: "int", align: "center" },
  ],
  thuc_giao: [
    { key: "khachHang", header: "Khách hàng", dimension: true, filterType: "KH" },
    { key: "hangHoa", header: "Hàng hóa", dimension: true, filterType: "HH" },
    { key: "phanLoai", header: "Phân loại", dimension: true, filterType: "PHANLOAI" },
    { key: "htvt", header: "Hình thức VT", dimension: true, filterType: "HTVT" },
    { key: "dvt", header: "ĐVVT", dimension: true, filterType: "DVT" },
    { key: "xe", header: "Xe", dimension: true, filterType: "XE" },
    { key: "ngayGiao", header: "Ngày giao", dimension: true },
    { key: "thucGiao", header: "Thực giao (tấn)", format: "num", align: "right" },
    { key: "soChuyenGiao", header: "Số chuyến", format: "int", align: "center" },
  ],
  giao_nhan: [
    { key: "xe", header: "Xe", dimension: true, filterType: "XE" },
    { key: "khachHang", header: "Khách hàng", dimension: true, filterType: "KH" },
    { key: "hangHoa", header: "Hàng hóa", dimension: true, filterType: "HH" },
    { key: "khGiao", header: "KH giao (tấn)", format: "num", align: "right" },
    { key: "thucGiao", header: "Thực giao (tấn)", format: "num", align: "right" },
    { key: "chenhLech", header: "Chênh lệch (tấn)", format: "num", align: "right" },
  ],
  doi_chieu: [
    { key: "ncc", header: "Nhà cung cấp", dimension: true, filterType: "NCC" },
    { key: "hangHoa", header: "Hàng hóa", dimension: true, filterType: "HH" },
    { key: "xe", header: "Xe", dimension: true, filterType: "XE" },
    { key: "thucNhan", header: "Nhận (tấn)", format: "num", align: "right" },
    { key: "thucGiao", header: "Giao (tấn)", format: "num", align: "right" },
    { key: "ton", header: "Tồn (tấn)", format: "num", align: "right" },
  ],
  van_tai: [
    { key: "dvt", header: "ĐVVT", dimension: true, filterType: "DVT" },
    { key: "xe", header: "Xe", dimension: true, filterType: "XE" },
    { key: "khachHang", header: "Khách hàng", dimension: true, filterType: "KH" },
    { key: "hangHoa", header: "Hàng hóa", dimension: true, filterType: "HH" },
    { key: "ngayGiao", header: "Ngày giao", dimension: true },
    { key: "thucGiao", header: "Thực giao (tấn)", format: "num", align: "right" },
    { key: "thucNhan", header: "Thực nhận (tấn)", format: "num", align: "right" },
    { key: "soChuyenVT", header: "Số chuyến", format: "int", align: "center" },
  ],
  vong_doi: [
    { key: "maDon", header: "Mã đơn" },
    { key: "ngayDat", header: "Ngày đặt" },
    { key: "ncc", header: "Nhà cung cấp" },
    { key: "tongKhGiao", header: "KH đặt", format: "num", align: "right" },
    { key: "tongThucNhan", header: "Thực nhận", format: "num", align: "right" },
    { key: "tongThucGiao", header: "Thực giao", format: "num", align: "right" },
    { key: "trangThai", header: "Trạng thái" },
    { key: "progress", header: "Tiến độ", align: "center" },
  ],
};

export const REPORT_SUBTAB_ACCESS: Record<string, string[]> = {
  ADMIN: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  MANAGER: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  PURCHASE: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  DISPATCHER: ["thuc_nhan", "thuc_giao", "giao_nhan", "doi_chieu", "van_tai", "vong_doi"],
  SALES: ["thuc_giao", "van_tai"],
  VIEWER: ["thuc_giao", "van_tai"],
  ACCOUNTANT: ["thuc_giao", "van_tai"],
  ACCOUNT: ["thuc_giao", "van_tai"],
};
