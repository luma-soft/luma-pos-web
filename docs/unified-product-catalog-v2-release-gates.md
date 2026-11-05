# Unified Catalog V2 — release and operations gates

This is an operator checklist, **not** a declaration that production is ready.
Keep the V1 endpoint and the iOS rollback switch until the tests below pass.

## Automated gates

The `Catalog verification` GitHub Actions workflow executes locked dependency
installation, full TypeScript check, focused and repository-wide ESLint, catalog
regressions, and a Next.js compile-only production build. The compile-only
job sets a dummy local `DATABASE_URL` solely because the database pool is
created when some route modules are imported. No production database is
contacted; this check is **not a production deployment or integration test**.

Run the latest workflow on `main` after source changes. Require green results
and review deployment status separately.

## Backup blocker (operator action required)

The `Database backups` workflow currently stops at `Prepare session database
connection` with `Missing DATABASE_URL repository secret`. **Do not disable
the backup schedule to hide this error.** Add the missing GitHub Actions
repository secret in GitHub Settings → Secrets and variables → Actions, with
the **session** Supabase pooler connection string on port 5432. Do not put
the value into source code, build logs, comments, or documentation.

Review and configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_PRIVATE_BUCKET` in the same protected
Actions secrets scope. After setup, run `Database backups` manually and
verify both the GitHub run and the expected backup object/recovery procedure.
Do not assume a successful queue insertion proves that an offsite backup exists.

## Native iOS

- Preserve the checked-in Keychain signing validation. Production/test builds
  need valid entitlements and signing; no anonymous unsigned installation.
- Test Release with `LUMA_UNIFIED_CATALOG_ENABLED=YES` on a **signed** TestFlight
  build, and verify the compiled Info.plist contains YES.
- Release default is NO while rollout is gated; `luma.catalog.forceLegacySync`
  remains the device rollback switch.
- On iPhone/iPad, verify first-install full snapshot, unchanged revision, multi-
  page delta, tombstones, schema and actor mismatch, offline relaunch, low disk
  space, and app foreground restoration.
- Preserve invoices, POS drafts, outbox entries, payment workflows, and
  existing SQLite data through migration and rollback.
- macOS GitHub Actions compiles the Release target with V2 explicitly enabled
  and runs selected catalog, delta, offline, SQLite rollback, and picker tests
  on a simulator. Passing these checks does **not** establish signed-device,
  Keychain, or TestFlight correctness.

## Stock Card and offline cache

- Product history is loaded per SKU and paginated; it is not part of the
  canonical catalog. Cached pages are scoped by store/user/role.
- The lightweight stock-history change token uses the latest audit movement,
  row count, and signed movement quantity total. This detects ordinary
  append/delete flows but not all historical edits to linked document prices.
  A manual **Làm mới Thẻ kho** action forces a full page refresh in those
  exceptional cases. A dedicated per-product history journal is a future
  option if historical document edits need automatic invalidation.
- Test product A versus product B changes (B must not cause a full history
  download for A), offline previously visited pages, online retry, page
  invalidation after new movements, variant/SKU selection, login role changes,
  and sign-out cleanup.
- A failure to persist IndexedDB must not make an online page unusable or
  invent an offline cache that was never committed.

## Production-like measurement

On representative stores with approximately 1,000, 10,000 and 50,000
products, record on real browsers and iPhones:
first full-sync payload bytes/time; warm startup; search/filter/pagination
latency; delta payload and changed SQLite/IndexedDB rows; memory usage;
duplicate refresh requests; network interruptions and recovery mode. Measure
Supabase query count/CPU/Egress/Realtime traffic before versus after using
the **same workload**. Synthetic benchmark numbers are not production
savings evidence.

## Promotion / rollback decision

Production rollout is complete only after deployment, database schema,
secrets and backups, signed iOS V2 testing, tenant/offline recovery checks,
and real-device resource measurements are independently verified. Keep
`/api/mobile/products/catalog` and the old iOS client compatibility window
until older clients are retired. Never remove migrations or cached offline
business documents as a rollback shortcut.
