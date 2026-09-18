# Quản lý Đặt hàng (quanlydathang)

Hệ thống Web Order – Next.js / Vercel + Google Sheets (Data Store).

**Giai đoạn hiện tại:** Mock data + Dashboard / Báo cáo read-only (mobile-first, light theme)

## Chạy local

```bash
cd quanlydathang
npm install
npm run dev
```

Mở http://localhost:3000

### Tài khoản demo

| Email | Mật khẩu | Role |
|-------|----------|------|
| admin@viethai.local | Admin@123 | ADMIN |
| purchase@viethai.local | Purchase@123 | PURCHASE |
| manager@viethai.local | Manager@123 | MANAGER |

## Deploy Vercel

1. Tạo repo GitHub `quanlydathang`
2. Trong thư mục project:

```bash
git init
git add .
git commit -m "Initial: Dashboard + Report mock theo kiến trúc V21"
git branch -M main
git remote add origin https://github.com/<user>/quanlydathang.git
git push -u origin main
```

3. Vercel → New Project → chọn repo → Deploy

## UI

- Light theme, mobile-first
- Bottom nav: Tổng quan · Đơn · Chi tiết · Giao · Kế hoạch
- Card layout cho Đơn / Chi tiết / Giao / Kế hoạch
- Bảng cho báo cáo
- Màu badge theo trạng thái
