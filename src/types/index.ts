export type Role =
  | "ADMIN"
  | "MANAGER"
  | "PURCHASE"
  | "DISPATCHER"
  | "SALES"
  | "VIEWER"
  | "ACCOUNTANT"
  | "ACCOUNT";

export type ScopeType = "OWNER" | "MANAGEMENT" | "OWN_CUSTOMER" | "ALL";

export type OrderStatus = "NEW" | "PROCESSING" | "DONE" | "CANCEL";
export type DetailStatus =
  | "NEW"
  | "ORDERED"
  | "RECEIVED"
  | "DELIVERING"
  | "DONE"
  | "CANCEL"
  | "DELETE";

export type PhanLoaiHH = "Bao" | "Roi" | "Khac";

export interface UserContext {
  email: string;
  hoTen: string;
  role: Role;
  quanly: string;
  permissions: string[];
}

export interface AccessScope {
  role: Role;
  scopeType: ScopeType;
  ownerEmail?: string;
  quanly?: string;
  customerIds?: string[];
  supplierIds?: string[];
}

export interface Order {
  orderId: string;
  orderDate: string;
  supplierId: string;
  supplierName?: string;
  sendCount: number;
  status: OrderStatus;
  detailCount: number;
  cancelledDetailCount: number;
  orderFile?: string;
  pendingMail: boolean;
  mailSentAt?: string;
  resendMail: boolean;
  createdBy: string;
}

export interface OrderDetail {
  detailId: string;
  orderId: string;
  orderDate: string;
  supplierId: string;
  supplierName?: string;
  vehicleId: string;
  vehiclePlate?: string;
  productId: string;
  productName?: string;
  quantity: number;
  regionId: string;
  regionName?: string;
  warehouse?: string;
  note?: string;
  status: DetailStatus;
  receivedDate?: string;
  actualReceived?: number;
  transportTypeId?: string;
  transportTypeName?: string;
  isDuyenHa?: boolean;
  phanLoai?: PhanLoaiHH;
}

export interface Delivery {
  deliveryId: string;
  detailId: string;
  customerId: string;
  customerName?: string;
  customerDetail?: string;
  plannedQty: number;
  actualQty?: number;
  deliveryDate?: string;
  note?: string;
  deleted?: boolean;
}

export interface ProductionPlan {
  id: string;
  programName: string;
  supplierId: string;
  supplierName?: string;
  productIds: string[];
  fromDate: string;
  toDate: string;
  plannedQuantity: number;
  actualQuantity: number;
  status: string;
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Payable {
  id: string;
  date: string;
  supplierId: string;
  supplierName?: string;
  type: "THANH_TOAN" | "CHIET_KHAU" | "DOI_TRU" | "DIEU_CHINH_GIAM" | "DIEU_CHINH_TANG";
  amount: number;
  productId?: string;
  regionId?: string;
  detailId?: string;
  documentNo?: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  active: boolean;
}

export interface OpeningBalance {
  id: string;
  year: number;
  supplierId: string;
  supplierName?: string;
  openingAmount: number;
  note?: string;
  closedBy?: string;
  closedAt?: string;
  active: boolean;
}

export interface ReportFilter {
  fromDate?: string;
  toDate?: string;
  year?: number;
  supplierId?: string;
  customerId?: string;
  productId?: string;
  phanLoai?: PhanLoaiHH[];
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
