# Unified Product Catalog V2 test report

## Status

This report records local verification of the current web and iOS worktrees on
2026-11-06. V1 compatibility remains in place, and the iOS Release flag remains
off by default. These checks do not certify a production rollout.

The earlier migration runner record is documented in
[the migration and rollout document](./unified-product-catalog-v2-migration.md).
A read-only snapshot was collected from the Supabase project configured for
this workspace on 2026-11-06 (ICT). No metrics export was available. The
snapshot did not apply migrations or write application data, and it does not
certify a production rollout.

## Web verification

- TypeScript check: passed.
- Focused catalog lint and full repository ESLint: passed with 0 errors and 8
  existing warnings.
- Focused tests: core catalog/cache/history **27 passed**, V2 API **6 passed**,
  V1 API **6 passed**, and PGlite migration simulation **4 passed**.
- Next.js production build: passed and generated 150 pages. It used a local
  compile-only `DATABASE_URL`; it did not connect to production. Existing
  non-fatal warnings mention missing `metadataBase` and three `fit-content`
  image widths.
- Stock Card state/cache checks cover cached offline history, uncached offline
  history, and scope mismatch. History remains per product and page; it is not
  part of the shared catalog.
- `git diff --check`: passed.

## iOS verification

- The app target's Release configuration defaults
  `LUMA_UNIFIED_CATALOG_ENABLED` to **NO**. `luma.catalog.forceLegacySync`
  remains the device rollback switch.
- A Release Simulator build with the flag explicitly set to **YES** passed on
  Xcode 27.2; the built app's Info.plist contained `YES`.
- The full `NativeInventoryProductBrowseModelTests` suite passed **58/58** on
  an iPhone Simulator. It covers offline cache use, full/delta synchronization,
  tombstones, cross-screen cache sharing, POS prices and units, release
  fallback, SQLite rollback, retry after a failed sync, relevance ordering,
  and catalog paging. The product-picker rendering test passed separately.
- The local Release Simulator build with V2 explicitly enabled produced an app
  bundle whose Info.plist contains `YES`.
- The native synthetic relevance benchmark reported **84 ms**, **830 ms**, and
  **4,210 ms** for 1k, 10k, and 50k candidates on the final Simulator run. These are
  local microbenchmark timings, not device or production screen-open latency.
- The selected picker test attached a Simulator screenshot to the `.xcresult`.
  Simulator emitted keyboard and coordinate-space diagnostics; the test passed.

## Web catalog search benchmark

Synthetic local benchmark, Bun 1.4.4, seven-sample medians. Timings compare the
previous scan with the V2 index; broad search returns the first 20 ranked
matches. Index construction and delta-apply work are shown separately.

| Products | Build index | SKU scan → index | Barcode scan → index | Name scan → index | Broad scan → index | Delta apply | Index patch |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 16.49 ms | 0.107 → 0.008 ms | 0.058 → 0.006 ms | 0.066 → 0.004 ms | 2.16 → 1.82 ms | 1.31 ms | 0.121 ms |
| 10,000 | 115.65 ms | 1.204 → 0.007 ms | 0.762 → 0.004 ms | 1.301 → 0.013 ms | 19.47 → 20.29 ms | 3.41 ms | 0.101 ms |
| 50,000 | 680.43 ms | 13.711 → 0.017 ms | 9.217 → 0.003 ms | 14.564 → 0.013 ms | 122.63 → 110.08 ms | 22.87 ms | 0.119 ms |

The index sharply reduces exact SKU, barcode, and name lookup time. Broad search
at 10k was about 4% slower in this synthetic run; results vary by query shape.
The benchmark is not a browser screen-open test.

## Supabase snapshot and measurement limits

- The configured database connection used session-mode port **5432** and
  reported PostgreSQL **17.11**. Database size was **85,989,043 bytes**
  (about **82.0 MiB**). The configured connection's project reference matched
  the workspace's `NEXT_PUBLIC_SUPABASE_URL` project reference.
- All **162** local Drizzle migrations were present in the database migration
  ledger; none were pending. Migrations `0149_catalog_delta_v2.sql` and
  `0150_catalog_statement_journal.sql` were recorded as applied. The database
  had **38** catalog revision triggers: 24 statement-level and 14 row-level.
- PostgreSQL relation estimates were 3,470 products (13,459,456 bytes), 7,362
  `catalog_delta_events` rows (1,466,368 bytes), 3 sync-state rows (401,408
  bytes), and 0 delta-floor rows (24,576 bytes). These are catalog statistics
  estimates, not exact live row counts.
- All **3** stores remained exactly at their V2 cutover floors: no revision gap,
  no events after a floor, and no structured events after a floor. The largest
  store had **3,463** products at revision **61,940**. Therefore there is no
  post-cutover V2 delta traffic from which to measure real delta savings.
- The app's full-snapshot helper returned a **6,784,045-byte** JSON payload for
  the largest store in one read (about **6.47 MiB**); that single call took
  **2.46 seconds** end to end. This is a one-off payload observation, not a
  latency benchmark.
- Since the PostgreSQL statistics reset on 2026-10-02, normalized SQL matching
  the delta-event and sync-state tables accumulated **6,141 calls**, **2,066 ms**
  total execution time, **14,746 rows**, and **10** blocks read. This is a
  cumulative mixed-query total, not a clean V1/V2 comparison. The available
  `pg_stat_statements` data is not an export of Supabase Egress, Realtime, CPU,
  or billing usage.

No production savings estimate can be made until representative V2 events are
written after cutover and before/after Supabase usage metrics are available.
The local PGlite migration simulation is not a substitute for those metrics.
Representative-store browser/iPhone measurements, signed TestFlight Release
verification, and the remaining gates are listed in
[the release and operations checklist](./unified-product-catalog-v2-release-gates.md).
