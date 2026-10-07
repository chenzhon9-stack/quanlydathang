/**
 * MASTER_CONFIG — parity V21.07
 * Schema UI + validation cho danh mục NCC/KH/HH/XE/HTVT/DVT/KV/NCC_HH
 */
import { SHEETS } from "@/lib/sheets/constants";

export type MasterType =
  | "NCC"
  | "KH"
  | "HH"
  | "XE"
  | "HTVT"
  | "DVT"
  | "KV"
  | "NCC_HH";

export type FieldType =
  | "text"
  | "email"
  | "number"
  | "textarea"
  | "checkbox"
  | "select"
  | "picker";

export type MasterFieldDef = {
  type: FieldType;
  required?: boolean;
  readonly?: boolean;
  label?: string;
  placeholder?: string;
  step?: string;
  options?: string[];
  pickerType?: MasterType;
};

export type MasterConfig = {
  sheet: string;
  key: string;
  active: string | null;
  nameField?: string;
  prefix?: string;
  stopWords?: string[];
  uniqueFields?: { field: string; error: string }[];
  displayFields: string[];
  requiredFields: string[];
  fieldTypes: Record<string, MasterFieldDef>;
  headerLabels: Record<string, string>;
};

const STOP_NCC = ["CONG TY", "CTY", "TNHH", "MTV", "MOT THANH VIEN", "CP", "CO PHAN"];
const STOP_KH = ["CONG TY", "CTY", "TNHH", "MTV", "CP"];
const STOP_DVT = [
  "CONG TY",
  "CTY",
  "TNHH",
  "MTV",
  "CP",
  "VAN TAI",
  "VT",
  "LOGISTICS",
];

export const MASTER_TYPES: MasterType[] = [
  "NCC",
  "KH",
  "HH",
  "XE",
  "HTVT",
  "DVT",
  "KV",
  "NCC_HH",
];

export const MASTER_CONFIG: Record<MasterType, MasterConfig> = {
  NCC: {
    sheet: SHEETS.NCC,
    key: "MaNCC",
    active: "HoatDong",
    nameField: "TenNCC",
    prefix: "NCC",
    stopWords: STOP_NCC,
    uniqueFields: [{ field: "TenNCC", error: "Tên NCC đã tồn tại." }],
    displayFields: [
      "MaNCC",
      "TenNCC",
      "HinhThucGui",
      "EmailNCC",
      "DienthoaiNCC",
      "ZaloUserId",
      "Quanly",
      "HoatDong",
      "Ghichu",
    ],
    requiredFields: ["MaNCC", "TenNCC"],
    fieldTypes: {
      MaNCC: { type: "text", readonly: true, label: "Mã NCC" },
      TenNCC: { type: "text", required: true, label: "Tên NCC" },
      EmailNCC: { type: "email", label: "Email" },
      HinhThucGui: {
        type: "select",
        options: ["Email", "ZALO", "APP"],
        label: "Hình thức gửi",
      },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
      DienthoaiNCC: {
        type: "text",
        placeholder: "VD: 0914720989",
        label: "Điện thoại",
      },
      ZaloUserId: { type: "text", label: "Zalo ID" },
      Quanly: { type: "text", label: "Quản lý (nhóm)" },
      Ghichu: { type: "textarea", label: "Ghi chú" },
    },
    headerLabels: {
      MaNCC: "Mã NCC",
      TenNCC: "Tên NCC",
      HinhThucGui: "Hình thức gửi",
      EmailNCC: "Email",
      DienthoaiNCC: "Điện thoại",
      ZaloUserId: "Zalo ID",
      Quanly: "Quản lý",
      HoatDong: "Trạng thái",
      Ghichu: "Ghi chú",
    },
  },
  KH: {
    sheet: SHEETS.KH,
    key: "MaKh",
    active: "HoatDong",
    nameField: "TenKhachhang",
    prefix: "KH",
    stopWords: STOP_KH,
    uniqueFields: [
      { field: "TenKhachhang", error: "Tên khách hàng đã tồn tại." },
    ],
    displayFields: [
      "MaKh",
      "TenKhachhang",
      "YeuCauChitiet",
      "Quanly",
      "LoaiKhach",
      "HoatDong",
      "Ghichu",
    ],
    requiredFields: ["MaKh", "TenKhachhang"],
    fieldTypes: {
      MaKh: { type: "text", readonly: true, label: "Mã KH" },
      TenKhachhang: { type: "text", required: true, label: "Tên khách hàng" },
      Quanly: { type: "text", label: "Quản lý (nhóm)" },
      YeuCauChitiet: { type: "checkbox", label: "Yêu cầu chi tiết KH" },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
      Ghichu: { type: "textarea", label: "Ghi chú" },
      LoaiKhach: {
        type: "select",
        options: ["REAL", "VIRTUAL", "SYSTEM"],
        label: "Loại khách",
      },
    },
    headerLabels: {
      MaKh: "Mã KH",
      TenKhachhang: "Tên khách hàng",
      YeuCauChitiet: "Yêu cầu chi tiết",
      Quanly: "Quản lý",
      HoatDong: "Trạng thái",
      LoaiKhach: "Loại khách",
      Ghichu: "Ghi chú",
    },
  },
  HH: {
    sheet: SHEETS.HH,
    key: "MaHH",
    active: "HoatDong",
    nameField: "TenHangHoa",
    prefix: "HH",
    stopWords: [],
    uniqueFields: [
      { field: "TenHangHoa", error: "Tên hàng hóa đã tồn tại." },
    ],
    displayFields: [
      "MaHH",
      "TenHangHoa",
      "TyleHaohut",
      "TyleChiahet",
      "PhanLoaiHH",
      "LoaiHinhVanChuyen",
      "HoatDong",
    ],
    requiredFields: ["MaHH", "TenHangHoa"],
    fieldTypes: {
      MaHH: { type: "text", readonly: true, label: "Mã hàng" },
      TenHangHoa: { type: "text", required: true, label: "Tên hàng hóa" },
      TyleHaohut: {
        type: "number",
        label: "Tỷ lệ hao hụt (%)",
        step: "0.01",
      },
      TyleChiahet: {
        type: "number",
        label: "Tỷ lệ chia hết (tấn)",
        step: "0.01",
      },
      PhanLoaiHH: {
        type: "select",
        options: ["Bao", "Roi", "Khac"],
        label: "Phân loại",
      },
      LoaiHinhVanChuyen: {
        type: "select",
        options: ["Mooc", "Bon"],
        label: "Loại hình VC",
      },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
    },
    headerLabels: {
      MaHH: "Mã hàng",
      TenHangHoa: "Tên hàng hóa",
      TyleHaohut: "Hao hụt (%)",
      TyleChiahet: "Chia hết (tấn)",
      PhanLoaiHH: "Phân loại",
      LoaiHinhVanChuyen: "Loại hình VC",
      HoatDong: "Trạng thái",
    },
  },
  XE: {
    sheet: SHEETS.XE,
    key: "MaXe",
    active: "HoatDong",
    nameField: "BienSoXe",
    prefix: "XE",
    stopWords: [],
    uniqueFields: [],
    displayFields: [
      "MaXe",
      "BienSoXe",
      "SoMooc",
      "Tenlaixe",
      "Banglai",
      "MaHTVT",
      "TenHTVT",
      "MaDVT",
      "TenDVT",
      "HoatDong",
      "Ghichu",
    ],
    requiredFields: ["MaXe", "BienSoXe", "MaHTVT"],
    fieldTypes: {
      MaXe: { type: "text", readonly: true, label: "Mã xe" },
      BienSoXe: {
        type: "text",
        required: true,
        placeholder: "VD: 38C-12345",
        label: "Biển số",
      },
      SoMooc: { type: "text", label: "Số mooc" },
      Tenlaixe: { type: "text", label: "Tên lái xe" },
      Banglai: { type: "text", label: "Bằng lái" },
      MaHTVT: {
        type: "picker",
        pickerType: "HTVT",
        required: true,
        label: "Hình thức VT",
      },
      MaDVT: { type: "picker", pickerType: "DVT", label: "Đơn vị VT" },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
      Ghichu: { type: "textarea", label: "Ghi chú" },
    },
    headerLabels: {
      MaXe: "Mã xe",
      BienSoXe: "Biển số",
      SoMooc: "Số mooc",
      Tenlaixe: "Lái xe",
      Banglai: "Bằng lái",
      MaHTVT: "Mã HTVT",
      TenHTVT: "Hình thức",
      MaDVT: "Mã ĐVVT",
      TenDVT: "Tên ĐVVT",
      HoatDong: "Trạng thái",
      Ghichu: "Ghi chú",
    },
  },
  HTVT: {
    sheet: SHEETS.HTVT,
    key: "MaHTVT",
    active: "HoatDong",
    nameField: "TenHTVT",
    prefix: "HTVT",
    stopWords: [],
    uniqueFields: [
      { field: "TenHTVT", error: "Tên hình thức vận tải đã tồn tại." },
    ],
    displayFields: ["MaHTVT", "TenHTVT", "CanChonDVT", "HoatDong", "Ghichu"],
    requiredFields: ["MaHTVT", "TenHTVT"],
    fieldTypes: {
      MaHTVT: { type: "text", readonly: true, label: "Mã HTVT" },
      TenHTVT: { type: "text", required: true, label: "Tên hình thức VT" },
      CanChonDVT: { type: "checkbox", label: "Yêu cầu chọn DVT?" },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
      Ghichu: { type: "textarea", label: "Ghi chú" },
    },
    headerLabels: {
      MaHTVT: "Mã HTVT",
      TenHTVT: "Tên hình thức VT",
      CanChonDVT: "Chọn DVT?",
      HoatDong: "Trạng thái",
      Ghichu: "Ghi chú",
    },
  },
  DVT: {
    sheet: SHEETS.DVT,
    key: "MaDVT",
    active: "HoatDong",
    nameField: "TenDVT",
    prefix: "DVT",
    stopWords: STOP_DVT,
    uniqueFields: [
      { field: "TenDVT", error: "Tên đơn vị vận tải đã tồn tại." },
    ],
    displayFields: [
      "MaDVT",
      "TenDVT",
      "Dienthoai",
      "Diachi",
      "Quanly",
      "HoatDong",
    ],
    requiredFields: ["MaDVT", "TenDVT"],
    fieldTypes: {
      MaDVT: { type: "text", readonly: true, label: "Mã DVT" },
      TenDVT: { type: "text", required: true, label: "Tên đơn vị VT" },
      Quanly: { type: "text", label: "Quản lý (nhóm)" },
      Dienthoai: {
        type: "text",
        placeholder: "VD: 0914720989",
        label: "Điện thoại",
      },
      Diachi: { type: "text", label: "Địa chỉ" },
      MST: { type: "text", label: "Mã số thuế" },
      NguoiLienHe: { type: "text", label: "Người liên hệ" },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
      Ghichu: { type: "textarea", label: "Ghi chú" },
    },
    headerLabels: {
      MaDVT: "Mã DVT",
      TenDVT: "Tên đơn vị VT",
      Dienthoai: "Điện thoại",
      Diachi: "Địa chỉ",
      Quanly: "Nhóm QL",
      MST: "Mã số thuế",
      NguoiLienHe: "Người liên hệ",
      HoatDong: "Trạng thái",
      Ghichu: "Ghi chú",
    },
  },
  KV: {
    sheet: SHEETS.KV,
    key: "Makv",
    active: null,
    nameField: "Khuvuc",
    prefix: "KV",
    stopWords: [],
    uniqueFields: [{ field: "Khuvuc", error: "Tên khu vực đã tồn tại." }],
    displayFields: ["Makv", "Khuvuc"],
    requiredFields: ["Makv", "Khuvuc"],
    fieldTypes: {
      Makv: { type: "text", readonly: true, label: "Mã KV" },
      Khuvuc: { type: "text", required: true, label: "Khu vực" },
    },
    headerLabels: {
      Makv: "Mã KV",
      Khuvuc: "Khu vực",
    },
  },
  NCC_HH: {
    sheet: SHEETS.NCC_HH,
    key: "MaNCCHH",
    active: "HoatDong",
    prefix: "NCCHH",
    stopWords: [],
    uniqueFields: [],
    displayFields: ["MaNCCHH", "MaNCC", "MaHH", "HoatDong", "GhiChu"],
    requiredFields: ["MaNCCHH", "MaNCC", "MaHH"],
    fieldTypes: {
      MaNCCHH: { type: "text", readonly: true, label: "Mã ghép" },
      MaNCC: {
        type: "picker",
        pickerType: "NCC",
        required: true,
        label: "Mã NCC",
      },
      MaHH: {
        type: "picker",
        pickerType: "HH",
        required: true,
        label: "Mã HH",
      },
      GhiChu: { type: "textarea", label: "Ghi chú" },
      HoatDong: { type: "checkbox", label: "Hoạt động" },
    },
    headerLabels: {
      MaNCCHH: "Mã ghép",
      MaNCC: "Mã NCC",
      MaHH: "Mã HH",
      HoatDong: "Trạng thái",
      GhiChu: "Ghi chú",
    },
  },
};

export function isMasterType(v: string): v is MasterType {
  return MASTER_TYPES.includes(String(v || "").toUpperCase() as MasterType);
}

export function getMasterConfig(type: string): MasterConfig | null {
  const t = String(type || "").toUpperCase();
  if (!isMasterType(t)) return null;
  return MASTER_CONFIG[t];
}

/** Public schema for UI (no heavy data) */
export function getMasterSchemaPublic(type: string) {
  const cfg = getMasterConfig(type);
  if (!cfg) return null;
  return {
    type: String(type).toUpperCase(),
    key: cfg.key,
    active: cfg.active,
    nameField: cfg.nameField || null,
    displayFields: cfg.displayFields,
    requiredFields: cfg.requiredFields,
    fieldTypes: cfg.fieldTypes,
    headerLabels: cfg.headerLabels,
    canSoftDelete: !!cfg.active,
  };
}
