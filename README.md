# Sales Mgmt

Hệ thống quản lý bán hàng cho cửa hàng VLXD / thiết bị điện nước / thiết bị nhà bếp.

## Runtime hiện tại và kiến trúc đích

### Runtime hiện tại trong giai đoạn chuyển đổi

- **Framework**: Next.js 16 (App Router) + TypeScript + Turbopack
- **DB/Auth**: Supabase Postgres + Supabase Auth; Drizzle ORM được Next.js server sử dụng
- **Hosting**: Vercel; một số luồng đồng bộ còn dùng Supabase relay/Realtime
- Các client gửi request nghiệp vụ qua Next.js API/server actions; một số luồng Auth, Realtime, Storage và relay vẫn gọi Supabase trực tiếp.

### Kiến trúc đích đã chốt

- PostgreSQL là nguồn dữ liệu kinh doanh duy nhất; Next.js tự host cùng PostgreSQL trên Mac tại cửa hàng trước, rồi chuyển cùng schema và hành vi lên VPS.
- Next.js là API/backend duy nhất cho web và iPhone. Client không kết nối PostgreSQL trực tiếp.
- Không dùng Supabase Cloud hoặc Supabase self-host trong kiến trúc đích. Auth, relay, Realtime, Storage và tác vụ nền sẽ được thay bằng thành phần do LumaPOS vận hành.
- Web giữ dữ liệu offline trong IndexedDB; iPhone giữ dữ liệu trong SQLite. Thay đổi offline được gửi tới backend LumaPOS để xác nhận hoặc trả conflict.
- **Quản trị database**: pgAdmin 4 Desktop trên Mac, chỉ dành cho quản trị viên DB. Không cấp quyền SQL cho tài khoản người dùng POS.
- **UI**: Tailwind CSS v4 + Lucide icons

Chi tiết quyết định và rollout: [ADR-0002](docs/adr/0002-self-hosted-postgresql-nextjs.md).
Vận hành Mac/VPS: [self-hosted operations](docs/self-hosted-operations.md); danh
sách phụ thuộc còn chuyển: [Supabase dependency matrix](docs/self-hosted-dependency-matrix.md).

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
apply toàn bộ migration hiện có lên database đích. Mặc định đích là
`lumapos_local`; có thể đặt `LUMAPOS_LOCAL_DATABASE_NAME` để tạo database diễn
tập riêng mà không chạm vào snapshot đang giữ.

**Trạng thái đã xác minh ngày 2026-11-13:** PostgreSQL local chấp nhận kết nối;
`lumapos_local` có 177 migration tới `0165_cleanup_storage_provider.sql`, 3
cửa hàng, 3 hồ sơ, 3.292 sản phẩm, 3.157 đơn và 469 media object. Đối soát chỉ
đọc với database đang cấu hình cho thấy migration khớp nhưng dữ liệu chưa khớp:
9 bảng lệch số dòng, gồm tồn kho và biến động kho. Vì vậy `lumapos_local` chưa
được xác nhận là nguồn chính; không chạy importer vào database này.

Trong cùng đợt kiểm tra, `lumapos_rehearsal` được tạo riêng, nhập từ database
đang cấu hình và đối soát thành công 138 bảng, các tổng hợp tài chính, 3 hồ sơ,
3 Auth credentials và trạng thái receipt sync. DB này chỉ là bản rehearsal; chưa bật
Auth/backend mới, chưa chuyển media bytes sang filesystem local và chưa nhận ghi
từ client.

Để diễn tập trên database rỗng riêng, dùng cùng tên đích cho migration, import
và đối soát. Ví dụ:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal bun run db:migrate:local
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal bun run db:import:local -- --confirm-bootstrap-target
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal bun run db:reconcile:local
```

Lệnh tạo dump trước, giữ nguyên dữ liệu nguồn và chỉ nhận target bootstrap
trống. Nó nhập credentials tương thích và biên nhận relay cũ; không nhập
session/token Auth, heartbeat worker hay lịch sử backup. Receipt `processing`
được đưa về `pending`; receipt kết thúc giữ trạng thái. Đây là snapshot một lần,
không phải đồng bộ liên tục. Khi cutover, tạo một database target mới, rỗng và
được đặt tên riêng; không dùng importer để ghi đè `lumapos_local` đang có dữ liệu.

`sync:relay:local` và `LUMAPOS_SYNC_RELAY_ENABLED` chỉ thuộc relay Supabase cũ
trong giai đoạn chuyển đổi. Không bật hoặc mở rộng relay này cho kiến trúc đích.
Target dùng `bun run sync:postgres:worker`, inbox trong PostgreSQL và API
`/api/sync/relay` theo Auth provider đang bật. Xem
[runbook self-hosted](docs/self-hosted-operations.md) trước mọi thao tác nhập,
đối soát hoặc cutover.

## Quản trị PostgreSQL bằng pgAdmin 4

pgAdmin 4 Desktop là công cụ quản trị được chọn cho môi trường Mac tại cửa hàng.
Khi provision runtime đích, đăng ký server PostgreSQL local với host `127.0.0.1`,
port `5432` và maintenance database `lumapos_local`. Dùng role quản trị riêng cho
pgAdmin và role runtime giới hạn quyền cho ứng dụng. Không mở pgAdmin hoặc cổng
PostgreSQL ra Internet.

`bun db:studio` vẫn có thể dùng như công cụ tiện ích cho nhà phát triển, nhưng
không thay pgAdmin trong quy trình vận hành. Người dùng POS thông thường chỉ
được thao tác qua màn hình quản trị LumaPOS theo vai trò, không được cấp quyền
pgAdmin hoặc SQL.

Backend có hai endpoint vận hành không cần đăng nhập: `/api/health/live` chỉ xác
nhận tiến trình Next.js phản hồi; `/api/health/ready` kiểm tra PostgreSQL cùng
heartbeat worker bắt buộc và trả HTTP 503 khi thành phần chưa sẵn sàng. Hai
endpoint không trả lỗi nội bộ hoặc thông tin kết nối.

## Chuyển Auth và đồng bộ sang PostgreSQL

`LUMAPOS_AUTH_PROVIDER` mặc định là `supabase` để bản runtime cũ tiếp tục hoạt
động. Chỉ đặt thành `lumapos` sau khi đã nhập `auth_credentials`, hoàn tất các
luồng sync inbox và cài worker PostgreSQL. Web dùng cookie `HttpOnly`; iPhone
tiếp tục dùng hợp đồng `/api/mobile/auth/*` và cất access/refresh token trong
Keychain. Khi bật provider `lumapos`, API relay dùng inbox PostgreSQL; không bật
provider mới trước khi snapshot được đối soát và cả worker đã sẵn sàng.

Worker `bun run sync:postgres:worker` dùng advisory lock PostgreSQL, nhận lệnh
theo `FOR UPDATE SKIP LOCKED` và xử lý qua cùng domain command với API. Chỉ bật
`LUMAPOS_PRIMARY_DATABASE_CONFIRMED=true` sau khi snapshot local đã được đối soát
và chọn làm nguồn dữ liệu chính. Trên Mac/VPS, chạy worker dưới process
supervisor thay vì một cron ngắn hạn.

Worker notification và backup cùng trạng thái vận hành được mô tả trong
[runbook self-hosted](docs/self-hosted-operations.md). Runtime phục vụ vẫn là
legacy; PostgreSQL local đã được kiểm tra và nâng schema nhưng chưa được chọn làm
nguồn dữ liệu chính.

## Setup runtime hiện tại (chỉ trong giai đoạn chuyển đổi)

Các bước Supabase bên dưới chỉ để duy trì runtime đang chạy cho tới cutover; chúng
không mô tả kiến trúc đích.

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
