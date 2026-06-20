# Sales Mgmt

Hệ thống quản lý bán hàng cho cửa hàng VLXD / thiết bị điện nước / thiết bị nhà bếp.

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + Turbopack
- **DB**: Supabase Postgres + Drizzle ORM
- **Auth**: Supabase Auth (email/password)
- **UI**: Tailwind CSS v4 + Lucide icons
- **Realtime**: Supabase Realtime (sync stock giữa POS)

## Setup (lần đầu)

### 1. Tạo Supabase project

1. Signup [supabase.com](https://supabase.com) → New project
2. Region: **Singapore** (gần VN nhất)
3. Đợi ~2 phút tạo xong
4. Copy 3 keys:
   - `Project URL` (Settings → API)
   - `anon` key (Settings → API)
   - `service_role` key (Settings → API, giữ bí mật)
   - Connection string (Settings → Database → URI mode → **Connection pooling**)

### 2. Cấu hình env

```bash
cp .env.example .env.local
# Mở .env.local, paste các keys vừa copy
```

### 3. Tạo bảng DB

```bash
bun db:push          # Apply schema lên Supabase
bun db:seed          # Insert categories, brands, warehouse mẫu
```

### 4. Tạo user admin đầu tiên

Vào Supabase Dashboard → Authentication → Users → Add user
- Email: admin@yourshop.com
- Password: (đặt mật khẩu)
- Auto confirm: ✓

### 5. Chạy

```bash
bun dev
# Mở http://localhost:3000 → đăng nhập
```

## Scripts

| Lệnh | Mô tả |
|------|-------|
| `bun dev` | Dev server (Turbopack) |
| `bun build` | Production build |
| `bun db:push` | Apply schema thay đổi lên Supabase |
| `bun db:generate` | Generate migration SQL files |
| `bun db:studio` | Mở Drizzle Studio (UI xem/sửa data) |
| `bun db:seed` | Insert data mẫu (categories, brands) |
| `bun import:kiotviet path.xlsx` | Import từ Excel KiotViet |

## Schema highlights (đặc thù VLXD)

- `products` có `m2_per_unit` → tính m² gạch tự động
- `product_units` → 1 SP nhiều đơn vị (viên/hộp/m²/pallet)
- `customers.type` → retail/wholesale/contractor/agent (4 bảng giá)
- `orders` có `project_name` + đặt cọc qua `payments`
- `customers.current_debt` → công nợ tự động cập nhật
- `stock_movements` → log mọi thay đổi tồn kho

## Trạng thái (06/2026)

Web hoàn chỉnh — đã deploy được lên Vercel (xem `DEPLOY.md`):

- [x] Auth + DB schema (5 migrations, tracking bảng `_migrations`)
- [x] Sản phẩm: CRUD, multi-unit, 4 bảng giá, thiết lập giá tập trung (/pricing)
- [x] POS: giá theo nhóm khách, KM bậc thang, tính m² gạch, lưu tạm nhiều giỏ, báo giá
- [x] Đơn hàng: chi tiết, thu nợ, hủy, sửa đơn, gộp đơn, trả hàng (hoàn kho/trừ nợ)
- [x] Kho: tồn + cảnh báo min, kiểm kho cân bằng, nhập hàng + nợ NCC
- [x] Tài chính: sổ quỹ tự ghi, công nợ KH/NCC, HĐĐT (stub provider)
- [x] In ấn: A4/A5/K80, editor mẫu in, in hàng loạt
- [x] Khác: công trình, portal đặt hàng theo token, dashboard + báo cáo (DT/lãi gộp/KH/NV)
- [x] UI khớp design mockups (`design/index.html`) — 4 theme, demo data: `bun db:seed-demo`
- [ ] Tích hợp HĐĐT thật (Viettel/VNPT/MISA — thay `issueWithProvider()`)
- [ ] Điều xe giao hàng (đã code, đang tắt — xem `src/app/(app)/delivery/page.tsx`)
- [ ] Import KiotViet
- [ ] Mobile app (Flutter)

## Tests

```bash
bun add -d @electric-sql/pglite   # 1 lần
for f in tests/*.test.mjs; do node --experimental-strip-types "$f"; done
```

5 suite / ~85 checks chạy trên PGlite với đúng migrations thật.
