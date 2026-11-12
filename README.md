# Sales Mgmt

Hệ thống quản lý bán hàng cho cửa hàng VLXD / thiết bị điện nước / thiết bị nhà bếp.

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + Turbopack
- **DB hiện tại**: Supabase Postgres + Drizzle ORM
- **DB mục tiêu**: PostgreSQL trên Mac tại cửa hàng, có thể chuyển lên VPS sau này
- **Auth**: Supabase Auth (email/password)
- **UI**: Tailwind CSS v4 + Lucide icons
- **Realtime hiện tại**: Supabase Realtime (sync stock giữa POS)
- **Sync mục tiêu**: Supabase chỉ chuyển tiếp dữ liệu giữa các thiết bị; PostgreSQL local giữ dữ liệu kinh doanh đã xác nhận

## PostgreSQL local trên macOS

Khởi tạo PostgreSQL 17 và database `lumapos_local` trên Mac:

```bash
bun db:setup:local
```

PostgreSQL chỉ lắng nghe trên loopback của Mac. Lệnh này không apply schema và
không copy dữ liệu từ Supabase.

Để tạo schema local theo migration hiện tại, chạy:

```bash
bun db:migrate:local
```

Lệnh này thêm các compatibility objects local cần cho migration lịch sử rồi
apply toàn bộ migration hiện có lên `lumapos_local`. Schema đã được tạo, nhưng
database local chỉ có dữ liệu cửa hàng sau khi chạy bước nhập bên dưới. Runtime của app vẫn dùng database đang cấu
hình; chưa chuyển sang PostgreSQL local cho đến khi hoàn tất nhập dữ liệu và
chuyển các luồng đọc/ghi cùng sync sang Mac.

Để nhập một bản sao dữ liệu hiện tại từ database đang cấu hình vào database
local còn rỗng, chạy:

```bash
bun db:import:local
```

Lệnh dùng kết nối session hiện có, giữ nguyên dữ liệu nguồn và chỉ chạy khi
`lumapos_local` không có dữ liệu ngoài các hàng mẫu do migration tạo. File dump
tạm được xóa sau khi nhập xong; sự kiện và thành viên của hàng đợi sync không
được sao chép. Đây là bản sao tại thời điểm chạy, chưa phải đồng bộ liên tục.

Bộ xử lý relay chỉ chạy sau khi đã đối soát bản sao local và tuyên bố PostgreSQL
trên Mac là database chính thức. Khi đã sẵn sàng, đặt cờ xác nhận cho riêng tiến
trình:

```bash
LUMAPOS_LOCAL_AUTHORITY_CONFIRMED=true bun run sync:relay:local
```

Bộ xử lý chỉ mở kết nối PostgreSQL qua `127.0.0.1`, kéo lệnh chờ từ Supabase,
và ghi kết quả xác nhận trở lại relay. Không mở cổng PostgreSQL ra Internet.

Relay trên web mặc định bị khóa. Chỉ đặt `LUMAPOS_SYNC_RELAY_ENABLED=true` trong
môi trường chạy web sau khi đã đối soát dữ liệu local, cài worker trên Mac và
chuẩn bị chuyển toàn bộ luồng ghi POS được hỗ trợ sang PostgreSQL local. Khi
cờ chưa bật, web tiếp tục dùng luồng hiện tại và endpoint relay không nhận lệnh.

## Setup (lần đầu)

### 1. Tạo Supabase project

1. Signup [supabase.com](https://supabase.com) → New project
2. Region: **Singapore** (gần VN nhất)
3. Đợi ~2 phút tạo xong
4. Copy 3 keys:
   - `Project URL` (Settings → API)
   - `anon` key (Settings → API)
   - `service_role` key (Settings → API, giữ bí mật)
   - App connection string: Transaction pooler port `6543`
   - Migration connection string: Session pooler port `5432` (hoặc Direct port `5432` nếu máy có IPv6)

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
| `bun db:push` | Apply schema qua `MIGRATION_DATABASE_URL` direct/session |
| `bun db:generate` | Generate migration SQL files |
| `bun db:studio` | Mở Drizzle Studio (UI xem/sửa data) |
| `bun db:seed` | Insert data mẫu (categories, brands) |
| `bun import:kiotviet path.xlsx` | Import từ Excel KiotViet |

## UI conventions

- Không dùng native browser modal (`alert`, `confirm`, `prompt`, `window.alert`, `window.confirm`, `window.prompt`) trong production UI.
- Confirm/alert phải dùng `ConfirmDialogProvider` hoặc component dialog/sheet theo design system.
- Các flow cần nhập text trong modal phải dùng component UI của app, có overlay, nút hủy/xác nhận, keyboard handling và style Tailwind/Luma tokens.
- Mobile hoặc bottom-sheet flow cũng phải dùng component UI của app, không gọi modal native của trình duyệt.

## AI assistant conventions

- `src/components/ai-assistant-launcher.tsx` chỉ mount workspace/FAB/panel. Không nhét API client, session state, preview rendering, composer, attachment handling hoặc helper nghiệp vụ vào file launcher.
- Code assistant phải tách theo boundary dưới `src/components/ai-assistant/`: `api.ts` cho fetch/upload, `use-assistant-state.ts` cho state/effects, `utils.ts` cho helper thuần, và component `.tsx` riêng cho header/chat surface/preview/attachment.
- Mọi UI text của assistant phải đi qua `messages/en.json` và `messages/vi.json` trong namespace `ai.*`. Không hard-code label tiếng Việt/Anh trong component; chỉ để dữ liệu backend/user-entered text render nguyên trạng.
- Component assistant phải kế thừa primitives chung trong `src/components/ui` (`Button`, `Input`, `Textarea`, `Select`, `Text`, `Section`, ...). Chỉ dùng thẻ HTML trực tiếp khi primitive hiện có không phù hợp về semantics.
- Khi thêm action/preview mới, cập nhật đủ i18n key cho badge, mô tả xác nhận, trạng thái, lỗi và test/verification liên quan trước khi merge.

## Schema highlights (đặc thù VLXD)

- `products` có `m2_per_unit` → tính m² gạch tự động
- `product_units` → 1 SP nhiều đơn vị (viên/hộp/m²/pallet)
- `customers.type` → retail/wholesale/contractor/agent (4 bảng giá)
- `orders` có `project_name` + đặt cọc qua `payments`
- MoMo/ZaloPay/VNPay gateway intents are enabled only with complete server-side
  credentials and `PAYMENT_CALLBACK_BASE_URL` (public HTTPS). Provider redirects
  are informational; only verified IPN/callbacks with exact provider/reference/
  amount settle orders. Pending status polling is also recovered through the
  providers' signed/merchant-bound transaction inquiry APIs, throttled per
  payment; inquiry evidence must match the server-owned reference and amount
  before settlement. Returns to an original gateway use a separate durable
  refund ledger and provider refund/query APIs; return acceptance never posts a
  bank cash-out until exact refund evidence is confirmed. See `.env.example`
  for the sandbox configuration keys.
- Manual cash/card follow-up payments use a stable client request ID plus an
  order row lock. Replaying a request after a lost mobile response returns the
  existing payment and cannot duplicate payment, cashbook, debt, or
  `amount_paid` mutations. F&B cart writes and checkout also rebuild product
  identity/prices and configured modifier deltas from active server records;
  kitchen-sent lines are immutable to client cart updates.
- E-invoice requests use a durable `queued → processing → issued|error` worker
  with bounded retry and stale-lock recovery. The production adapter calls a
  merchant-owned HTTPS bridge using a stable request ID and HMAC-signed exact
  request/response bodies; forged, stale, pending, or malformed evidence never
  becomes an issued invoice. Configure the selected provider bridge only with
  the server-side `EINVOICE_BRIDGE_*` variables in `.env.example`. Mobile
  settings receives only a secret-free readiness projection, and an explicit
  manual retry reuses the invoice request identity while resetting the bounded
  automatic retry budget.
- `customers.current_debt` → công nợ tự động cập nhật
- `stock_movements` → log mọi thay đổi tồn kho

## Trạng thái (06/2026)

Web hoàn chỉnh — đã deploy được lên Vercel (xem `DEPLOY.md`):

- [x] Auth + DB schema (5 migrations, tracking bảng `_migrations`)
- [x] Sản phẩm: CRUD, multi-unit, 4 bảng giá, thiết lập giá tập trung (/pricing)
- [x] POS: giá theo nhóm khách, KM bậc thang, tính m² gạch, lưu tạm nhiều giỏ, báo giá
- [x] Đơn hàng: chi tiết, thu nợ, hủy, sửa đơn, gộp đơn, trả hàng (hoàn kho/trừ nợ)
- [x] Kho: tồn + cảnh báo min, kiểm kho cân bằng, nhập hàng + nợ NCC
- [x] Tài chính: sổ quỹ tự ghi, công nợ KH/NCC, hàng đợi HĐĐT + signed bridge
- [x] In ấn: A4/A5/K80, editor mẫu in, in hàng loạt
- [x] Khác: công trình, portal đặt hàng theo token, dashboard + báo cáo (DT/lãi gộp/KH/NV)
- [x] UI khớp design mockups (`design/index.html`) — 4 theme, demo data: `bun db:seed-demo`
- [ ] HĐĐT production: deploy bridge mapping cho vendor đã chọn, cấu hình
  credential/callback và hoàn tất sandbox acceptance certification
- [ ] Điều xe giao hàng (đã code, đang tắt — xem `src/app/(app)/delivery/page.tsx`)
- [ ] Import KiotViet
- [ ] Mobile app (Flutter)

## Tests

```bash
bun add -d @electric-sql/pglite   # 1 lần
bun test tests/*.test.ts
for f in tests/*.test.mjs; do bun "$f"; done
```

Các test TypeScript chạy bằng Bun; các suite `.test.mjs` chạy riêng trên PGlite
với đúng migration thật. Mobile production-readiness verification hiện bao gồm
102 TypeScript tests và 20 database-backed suites; xem
`../luma-pos-mobile/docs/mobile_production_readiness.md` để biết gate mới nhất.
