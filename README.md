# Quản lý Đặt hàng (quanlydathang)

Next.js / Vercel + Google Sheets (Data Store). Kiến trúc V21 → Strangler.

## Phase hiện tại

- UI: sidebar desktop, card mobile (Đơn / Chi tiết / Giao / KH), bảng desktop
- Auth mock
- **Report read**: Google Sheets nếu có env Service Account; không thì fallback mock

## Env (bắt buộc để đọc Sheet thật)

Tạo `.env.local` (local) hoặc Environment Variables trên Vercel:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=1Kt7Yem2kZQQyEvF6iVHA9PQ-yCwu9R71OEg7nMNS_EQ
GOOGLE_SHEETS_SPREADSHEET_ID_2025=1_euuscjEAJ274S-8Ce1--irgDDBWaVUtKBuuW4jGmyk
GOOGLE_SERVICE_ACCOUNT_EMAIL=quanlydathang-sheets@viethai-quanlydathang.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
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
