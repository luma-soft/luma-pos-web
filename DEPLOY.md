# Deploy lên Vercel

## Chuẩn bị (1 lần)

### 1. Lấy hai connection string đúng mục đích

Supabase Dashboard → project → nút **Connect** (trên cùng) → tab **URI**:

- **Session pooler** (port `5432`, host `aws-*.pooler.supabase.com`) → `MIGRATION_DATABASE_URL`, chỉ dùng cho migration (`bun db:push` / `apply-migrations`)
- **Transaction pooler** (port `6543`, cùng host) → `DATABASE_URL`, dùng cho app serverless trên **Vercel**

> `MIGRATION_DATABASE_URL` bắt buộc là endpoint direct/session giữ nguyên một backend PostgreSQL. Runner từ chối port `6543` và query hint transaction/pgbouncer trước khi mở kết nối. Với Supabase, ưu tiên Session pooler port `5432`; Direct connection port `5432` cũng hợp lệ nếu máy chạy migration có IPv6.
>
> `DATABASE_URL` của app có thể tiếp tục dùng transaction pooler `6543`. Runner không tự fallback từ `MIGRATION_DATABASE_URL` sang biến này.

### 2. Apply migrations lên Supabase (từ máy local)

```bash
# .env.local/secret store đã có MIGRATION_DATABASE_URL port 5432
bun db:push
bun db:seed   # nếu DB mới
```

Không ghi URL thật vào shell history hoặc repo; đặt nó trong secret store/env của máy chạy migration. Migrations KHÔNG chạy lúc deploy — luôn chạy từ local/CI migration job trước khi deploy schema mới.

Để chạy concurrency test tùy chọn, chỉ trỏ vào database test dùng riêng và có thể xóa dữ liệu:

```bash
# Chỉ set TEST_MIGRATION_DATABASE_URL trong secret store của test job
bun test tests/migration-runner-postgres.test.mjs
```

Nếu biến này không được đặt, test sẽ skip và không kết nối database ngoài.

## Deploy

### Cách A — qua GitHub (khuyến nghị)

1. Push repo lên GitHub
2. [vercel.com/new](https://vercel.com/new) → Import repo → Vercel tự nhận Next.js + bun.lock
3. Khai báo **Environment Variables** (Production + Preview):

   | Tên | Giá trị |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key (Sensitive ✓) |
   | `DATABASE_URL` | **pooler string port 6543** (Sensitive ✓) |

4. Deploy. Region đã pin `sin1` (Singapore — cùng region Supabase) trong `vercel.json`.

### Cách B — Vercel CLI

```bash
npm i -g vercel
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add DATABASE_URL production   # pooler 6543
vercel --prod
```

## Sau deploy — checklist

- [ ] Supabase → **Authentication → URL Configuration**: thêm `https://<app>.vercel.app` vào *Site URL* + *Redirect URLs* (không thêm thì login redirect fail)
- [ ] Đăng nhập thử, tạo 1 đơn POS, xem dashboard
- [ ] Link portal khách (`/portal/<token>`) hoạt động không cần đăng nhập
- [ ] In thử hóa đơn A4/A5/K80

## Ghi chú kỹ thuật

- **Build đã verify pass** (compile + TypeScript + prerender 20 trang). Lưu ý build cần đủ 4 env vars (`src/db/index.ts` đọc `DATABASE_URL` lúc import).
- Font dùng system stack (không phụ thuộc Google Fonts lúc build, render tiếng Việt chuẩn).
- `NEXT_DIST_DIR` (tùy chọn): đổi thư mục build output cho CI — Vercel không cần set.
- Khi đổi schema: `bun db:push` từ local **trước**, rồi mới deploy code.
- Migration runner phải dùng `MIGRATION_DATABASE_URL` direct/session port `5432`; không dùng `DATABASE_URL` port `6543` của Vercel.
