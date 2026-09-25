/** Trạng thái ghi Sheet — parity V21 STATUS_DON / STATUS_CT */
export const STATUS_DON = {
  NEW: "Khởi tạo",
  PROCESSING: "Đang xử lý",
  DONE: "Hoàn thành",
  CANCEL: "Hủy đơn",
} as const;

export const STATUS_CT = {
  NEW: "Mới tạo",
  ORDERED: "Đặt hàng",
  RECEIVED: "Đã nhận",
  DELIVERING: "Đang giao",
  DONE: "Hoàn thành",
  CANCEL: "Hủy xe",
  DELETE: "Xóa xe",
} as const;

export { todayYmdVN } from "@/lib/sheets/date";
