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

   | Tên                             | Giá trị                                                    |
   | ------------------------------- | ---------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | `https://<ref>.supabase.co`                                |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key                                                   |
   | `SUPABASE_SERVICE_ROLE_KEY`     | service role key (Sensitive ✓)                             |
   | `DATABASE_URL`                  | **pooler string port 6543** (Sensitive ✓)                  |
   | `MEDIA_WRITE_PROVIDER`          | `r2` only after the managed-media rollout gates pass       |
   | `R2_ACCOUNT_ID`                 | Cloudflare account ID (Sensitive ✓)                        |
   | `R2_ACCESS_KEY_ID`              | R2 access-key ID (Sensitive ✓)                             |
   | `R2_SECRET_ACCESS_KEY`          | R2 secret access key (Sensitive ✓)                         |
   | `R2_PUBLIC_BUCKET`              | Public product-media bucket                                |
   | `R2_PRIVATE_BUCKET`             | Private project/service/AI bucket; must differ from public |
   | `R2_PUBLIC_BASE_URL`            | Public HTTPS custom-domain origin, without path/query      |
   | `CRON_SECRET`                   | 32+ character bearer used by protected cron routes         |

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

- [ ] Supabase → **Authentication → URL Configuration**: thêm `https://<app>.vercel.app` vào _Site URL_ + _Redirect URLs_ (không thêm thì login redirect fail)
- [ ] Đăng nhập thử, tạo 1 đơn POS, xem dashboard
- [ ] Link portal khách (`/portal/<token>`) hoạt động không cần đăng nhập
- [ ] In thử hóa đơn A4/A5/K80

## Managed media R2 release gates

Do not enable R2 writes from configuration alone. Run the server-side probe first;
it validates all six R2 variables, requires `MEDIA_WRITE_PROVIDER=r2`, validates
the public HTTPS origin, and sends `HeadBucket` to both configured buckets:

```bash
bun run media:r2:preflight
```

The command prints capability/boolean readiness only. It never prints account
credentials, bucket names, object keys, signed URLs, file names, or tenant data.
Only after it passes may release operators attest
`LUMA_R2_PUBLIC_BUCKET_REACHABLE=true` and
`LUMA_R2_PRIVATE_BUCKET_REACHABLE=true` for the mobile production preflight.

Roll out in this exact order:

1. Apply schema through `0119` and deploy dual-provider read support while R2 writes remain disabled in the production environment.
2. Probe non-production CORS, signed PUT, private signed GET, public custom domain, both bucket `HEAD` checks, and the protected cleanup cron.
3. Enable product-image R2 writes and monitor errors/fallbacks for 24 hours.
4. Enable project/service/installed-asset/warranty/customer-request writes and monitor for 48 hours.
5. Enable AI attachment writes and monitor for 24 hours.
6. Run migration inventory/copy/verify dry runs, then execute bounded batches using one reviewed run UUID per store.
7. Prefer R2 reads and monitor Supabase fallbacks for 30 days.
8. Delete Supabase source objects only after every retention, checksum, fallback, quarantine, cleanup-health, and rollback gate passes.

Required evidence before production promotion:

- [ ] `bun run media:r2:preflight` returns `ready: true` and `managed-media-r2-v1`.
- [ ] public and private bucket probes pass with distinct bucket names.
- [ ] signed PUT, private signed GET, and public custom-domain reads pass from the deployed origin/mobile client.
- [ ] `GET /api/cron/media/cleanup` rejects a wrong bearer and returns aggregate metrics for the valid bearer.
- [ ] migrations `0118` and `0119` are applied before the corresponding app code is deployed.
- [ ] no unresolved/quarantined migration item or recorded Supabase fallback remains before source deletion.

## Ghi chú kỹ thuật

- **Build đã verify pass** (compile + TypeScript + prerender 20 trang). Lưu ý build cần đủ 4 env vars (`src/db/index.ts` đọc `DATABASE_URL` lúc import).
- Font dùng system stack (không phụ thuộc Google Fonts lúc build, render tiếng Việt chuẩn).
- `NEXT_DIST_DIR` (tùy chọn): đổi thư mục build output cho CI — Vercel không cần set.
- Khi đổi schema: `bun db:push` từ local **trước**, rồi mới deploy code.
- Migration runner phải dùng `MIGRATION_DATABASE_URL` direct/session port `5432`; không dùng `DATABASE_URL` port `6543` của Vercel.
