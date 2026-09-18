import type {
  Order,
  OrderDetail,
  Delivery,
  ProductionPlan,
  Payable,
  OpeningBalance,
  UserContext,
} from "@/types";

export const MOCK_USERS: Record<string, { password: string; user: UserContext }> = {
  "admin@viethai.local": {
    password: "Admin@123",
    user: {
      email: "admin@viethai.local",
      hoTen: "Quản trị viên",
      role: "ADMIN",
      quanly: "ALL",
      permissions: ["*"],
    },
  },
  "purchase@viethai.local": {
    password: "Purchase@123",
    user: {
      email: "purchase@viethai.local",
      hoTen: "Nhân viên mua hàng",
      role: "PURCHASE",
      quanly: "A",
      permissions: [
        "ORDER_VIEW", "ORDER_CREATE", "ORDER_RECEIVE", "ORDER_SEND", "ORDER_CANCEL",
        "DELIVERY_VIEW", "DELIVERY_UPDATE", "DELIVERY_VIEW_ACTUAL_RECEIVE", "DELIVERY_VIEW_ACTUAL_DELIVER",
        "REPORT_VIEW", "PAYABLE_VIEW", "PAYABLE_CREATE", "PURCHASE_PRICE_VIEW", "PURCHASE_PRICE_UPDATE",
        "KHSL_VIEW", "KHSL_UPDATE",
      ],
    },
  },
  "manager@viethai.local": {
    password: "Manager@123",
    user: {
      email: "manager@viethai.local",
      hoTen: "Quản lý",
      role: "MANAGER",
      quanly: "A",
      permissions: [
        "DELIVERY_VIEW", "DELIVERY_UPDATE", "DELIVERY_VIEW_ACTUAL_RECEIVE", "DELIVERY_VIEW_ACTUAL_DELIVER",
        "PLAN_VIEW", "REPORT_VIEW", "PAYABLE_VIEW", "PURCHASE_PRICE_VIEW", "KHSL_VIEW",
      ],
    },
  },
};

/** Mock gần giống dữ liệu thật trên screenshot V21 */
export const MOCK_ORDERS_2026: Order[] = [
  { orderId: "No.BS260918-081549", orderDate: "2026-09-18", supplierId: "NCC03", supplierName: "Công ty cổ phần xi măng Bỉm Sơn", sendCount: 0, status: "NEW", detailCount: 2, cancelledDetailCount: 0, pendingMail: true, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260918-055126", orderDate: "2026-09-18", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 1, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260918-071054", orderDate: "2026-09-18", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 2, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DH260918-184816", orderDate: "2026-09-18", supplierId: "NCC01", supplierName: "CHI NHÁNH CÔNG TY TNHH DUYÊN HÀ - NHÀ MÁY XI MĂNG DUYÊN HÀ", sendCount: 1, status: "PROCESSING", detailCount: 2, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "phongxemaycongtyviethai@gmail.com" },
  { orderId: "No.HM260918-081710", orderDate: "2026-09-18", supplierId: "NCC04", supplierName: "Cty CP Xi măng Vicem Hoàng Mai", sendCount: 0, status: "NEW", detailCount: 1, cancelledDetailCount: 0, pendingMail: true, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.SL260918-085603", orderDate: "2026-09-18", supplierId: "NCC05", supplierName: "Công ty CP xi măng Sông Lam", sendCount: 0, status: "NEW", detailCount: 2, cancelledDetailCount: 0, pendingMail: true, resendMail: false, createdBy: "phongxemaycongtyviethai@gmail.com" },
  { orderId: "No.BS260917-084216", orderDate: "2026-09-17", supplierId: "NCC03", supplierName: "Công ty cổ phần xi măng Bỉm Sơn", sendCount: 1, status: "PROCESSING", detailCount: 5, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.BS260917-172046", orderDate: "2026-09-17", supplierId: "NCC03", supplierName: "Công ty cổ phần xi măng Bỉm Sơn", sendCount: 1, status: "PROCESSING", detailCount: 3, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.BT260917-191941", orderDate: "2026-09-17", supplierId: "NCC06", supplierName: "Công ty CP ĐT và TM Bình Tây", sendCount: 1, status: "PROCESSING", detailCount: 2, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260917-120933", orderDate: "2026-09-17", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 2, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260917-140331", orderDate: "2026-09-17", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 1, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260917-144207", orderDate: "2026-09-17", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 2, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.DD260917-150831", orderDate: "2026-09-17", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", sendCount: 1, status: "PROCESSING", detailCount: 4, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.HM260917-150925", orderDate: "2026-09-17", supplierId: "NCC04", supplierName: "Cty CP Xi măng Vicem Hoàng Mai", sendCount: 1, status: "PROCESSING", detailCount: 3, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
  { orderId: "No.HM260917-171540", orderDate: "2026-09-17", supplierId: "NCC04", supplierName: "Cty CP Xi măng Vicem Hoàng Mai", sendCount: 1, status: "PROCESSING", detailCount: 4, cancelledDetailCount: 0, pendingMail: false, resendMail: false, createdBy: "trungth2009@gmail.com" },
];

export const MOCK_DETAILS_2026: OrderDetail[] = [
  { detailId: "CT-260901-0001", orderId: "No.BS260917-084216", orderDate: "2026-09-17", supplierId: "NCC03", vehicleId: "XE001", productId: "XM001", productName: "Xi măng PCB40", quantity: 25.5, regionId: "KV01", status: "DONE", receivedDate: "2026-09-17", actualReceived: 25.2, transportTypeId: "NPP", phanLoai: "Bao" },
  { detailId: "CT-260901-0002", orderId: "No.BS260917-084216", orderDate: "2026-09-17", supplierId: "NCC03", vehicleId: "XE002", productId: "XM002", productName: "Xi măng PCB30", quantity: 18.0, regionId: "KV02", status: "RECEIVED", receivedDate: "2026-09-17", actualReceived: 17.8, transportTypeId: "NPP", phanLoai: "Bao" },
  { detailId: "CT-260901-0003", orderId: "No.DD260918-055126", orderDate: "2026-09-18", supplierId: "NCC02", vehicleId: "XE003", productId: "XM001", productName: "Xi măng PCB40", quantity: 22.0, regionId: "KV01", status: "ORDERED", phanLoai: "Bao" },
  { detailId: "CT-260910-0001", orderId: "No.BS260918-081549", orderDate: "2026-09-18", supplierId: "NCC03", vehicleId: "XE004", productId: "XM001", productName: "Xi măng PCB40", quantity: 30.0, regionId: "KV03", status: "NEW", phanLoai: "Bao" },
  { detailId: "CT-260915-0001", orderId: "No.HM260917-150925", orderDate: "2026-09-17", supplierId: "NCC04", vehicleId: "XE001", productId: "XM001", productName: "Xi măng PCB40", quantity: 22.0, regionId: "KV01", status: "RECEIVED", receivedDate: "2026-09-17", actualReceived: 21.8, phanLoai: "Bao" },
];

export const MOCK_DELIVERIES_2026: Delivery[] = [
  { deliveryId: "GH-260917-0001", detailId: "CT-260901-0001", customerId: "KH001", customerName: "Công trình A", plannedQty: 12.5, actualQty: 12.4, deliveryDate: "2026-09-17" },
  { deliveryId: "GH-260917-0002", detailId: "CT-260901-0001", customerId: "KH002", customerName: "Công trình B", plannedQty: 13.0, actualQty: 12.8, deliveryDate: "2026-09-17" },
  { deliveryId: "GH-260917-0003", detailId: "CT-260901-0002", customerId: "KH001", customerName: "Công trình A", plannedQty: 18.0, actualQty: 17.8, deliveryDate: "2026-09-18" },
  { deliveryId: "GH-260918-0001", detailId: "CT-260915-0001", customerId: "KH001", customerName: "Công trình A", plannedQty: 10.0, actualQty: 9.9, deliveryDate: "2026-09-18" },
  { deliveryId: "GH-260918-0002", detailId: "CT-260915-0001", customerId: "KH002", customerName: "Công trình B", plannedQty: 11.8, actualQty: 11.7, deliveryDate: "2026-09-18" },
];

export const MOCK_PLANS_2026: ProductionPlan[] = [
  { id: "KH-260901-0002", programName: "Tháng 9 - Long Sơn Rời", supplierId: "NCC07", supplierName: "CN Công ty TNHH Long Sơn tại Thanh Hóa - NM XM LONG SƠN", productIds: ["XM001", "XM002"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 7500, actualQuantity: 3446.35, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260901-0003", programName: "Tháng 9 - Bỉm Sơn bao KPK", supplierId: "NCC03", supplierName: "Công ty cổ phần xi măng Bỉm Sơn", productIds: ["XM001", "XM002"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 8500, actualQuantity: 2599.0, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260901-0004", programName: "Tháng 9 - Bỉm Sơn rời", supplierId: "NCC03", supplierName: "Công ty cổ phần xi măng Bỉm Sơn", productIds: ["XM001"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 3000, actualQuantity: 945.13, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260901-0005", programName: "Tháng 9 - Hoàng Mai bao", supplierId: "NCC04", supplierName: "Cty CP Xi măng Vicem Hoàng Mai", productIds: ["XM001", "XM002"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 1000, actualQuantity: 699.0, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260901-0006", programName: "Tháng 9 - Hoàng Mai rời", supplierId: "NCC04", supplierName: "Cty CP Xi măng Vicem Hoàng Mai", productIds: ["XM001"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 7000, actualQuantity: 4716.36, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260901-0007", programName: "Tháng 9 - Sông Lam", supplierId: "NCC05", supplierName: "Công ty CP xi măng Sông Lam", productIds: ["XM001", "XM002"], fromDate: "2026-09-01", toDate: "2026-09-30", plannedQuantity: 13125, actualQuantity: 6136.98, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260831-0001", programName: "Tháng 9 - Đại Dương (VH)", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", productIds: ["XM001"], fromDate: "2026-08-31", toDate: "2026-09-29", plannedQuantity: 7150, actualQuantity: 4216.0, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
  { id: "KH-260831-0002", programName: "Tháng 9 - Đại Dương (HTS)", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", productIds: ["XM001"], fromDate: "2026-08-31", toDate: "2026-09-29", plannedQuantity: 880, actualQuantity: 320.0, status: "Đang thực hiện", createdBy: "purchase@viethai.local", createdAt: "2026-08-25T08:00:00+07:00" },
];

export const MOCK_PAYABLES_2026: Payable[] = [
  { id: "CN-260905-0001", date: "2026-09-05", supplierId: "NCC01", supplierName: "NCC Duyên Hà", type: "THANH_TOAN", amount: 150000000, documentNo: "TT-0905", description: "Thanh toán đợt 1 tháng 9", createdBy: "accountant@viethai.local", createdAt: "2026-09-05T14:00:00+07:00", active: true },
  { id: "CN-260910-0001", date: "2026-09-10", supplierId: "NCC01", supplierName: "NCC Duyên Hà", type: "CHIET_KHAU", amount: 5000000, description: "Chiết khấu khối lượng lớn", createdBy: "purchase@viethai.local", createdAt: "2026-09-10T09:00:00+07:00", active: true },
  { id: "CN-260912-0001", date: "2026-09-12", supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", type: "THANH_TOAN", amount: 80000000, documentNo: "TT-0912", description: "Thanh toán đợt 1", createdBy: "accountant@viethai.local", createdAt: "2026-09-12T11:00:00+07:00", active: true },
];

export const MOCK_OPENING_2026: OpeningBalance[] = [
  { id: "DD-2026-NCC01", year: 2026, supplierId: "NCC01", supplierName: "NCC Duyên Hà", openingAmount: 45000000, note: "Dư đầu năm 2026", active: true },
  { id: "DD-2026-NCC02", year: 2026, supplierId: "NCC02", supplierName: "Công ty CP xi măng Đại Dương", openingAmount: 12000000, note: "Dư đầu năm 2026", active: true },
];

export function getOrdersByYear(_year: number): Order[] { return MOCK_ORDERS_2026; }
export function getDetailsByYear(_year: number): OrderDetail[] { return MOCK_DETAILS_2026; }
export function getDeliveriesByYear(_year: number): Delivery[] { return MOCK_DELIVERIES_2026; }
export function getPlansByYear(year: number): ProductionPlan[] { return MOCK_PLANS_2026.filter((p) => p.fromDate.startsWith(String(year))); }
export function getPayablesByYear(year: number): Payable[] { return MOCK_PAYABLES_2026.filter((p) => p.date.startsWith(String(year))); }
export function getOpeningByYear(year: number): OpeningBalance[] { return MOCK_OPENING_2026.filter((o) => o.year === year); }
