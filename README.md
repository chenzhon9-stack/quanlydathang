# Quản lý Đặt hàng (quanlydathang)

Next.js / Vercel + Google Sheets (Data Store). Kiến trúc V21 → Strangler.

## Phase hiện tại

- UI: sidebar desktop, card mobile (Đơn / Chi tiết / Giao / KH), bảng desktop
- Auth mock
- **Report read**: Google Sheets nếu có env Service Account; không thì fallback mock

## Env (bắt buộc để đọc Sheet thật)

Tạo `.env.local` (local) hoặc Environment Variables trên Vercel:

```env

```

- `GOOGLE_PRIVATE_KEY`: copy từ file JSON Service Account, giữ `\n`.
- Spreadsheet phải **share Editor** cho email Service Account.
- Scope API hiện tại: **readonly**.

### Tên tab Sheet (có thể sửa trong `src/repositories/report.repository.ts`)

| Key | Tên tab mặc định |
|-----|------------------|
| details | DonHang_Chitiet |
| deliveries | Chitiet_Giaohang |
| plans | KHSANLUONG |
| payables | NCC_CongNo |
| opening | NCC_DuDauNam |

## Chạy local

```bash
npm install
npm run dev
```

Demo login: `admin@viethai.local` / `Admin@123`

## Deploy Vercel

1. Push GitHub
2. Vercel → Project → Settings → Environment Variables (4 biến trên)
3. Redeploy

## Kiến trúc

```
API → Auth → ReportService → ReportRepository → Mapper → GoogleSheetsDAL → Sheets
                                         ↘ mock (nếu thiếu env)
```


## Order read (Phase B)

- `GET /api/v1/orders` đọc sheet tab **`DonHang`** khi có Service Account env.
- Mapper: `MaDon`, `NgayDatHang`, `MaNCC`, `TenNCC`, `LanGui`, `TrangThaiDon`, `TongSoChitiet`, `ChitietHuy`, `FileDonhang`, `ChoGuiMail`, `timeGuimail`, `GuiLaimail`, `User`.
- Tab sheet khác tên → sửa `SHEET_ORDERS` trong `src/repositories/order.repository.ts`.
- Lỗi đọc / thiếu env → fallback mock (app không sập).
