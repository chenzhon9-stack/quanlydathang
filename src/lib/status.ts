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

export function todayYmdVN(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
