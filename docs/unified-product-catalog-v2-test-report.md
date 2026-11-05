# Unified Product Catalog V2 test report

## Status

This report records local verification of the current web and iOS worktrees on
2026-11-06. V1 compatibility remains in place, and the iOS Release flag remains
off by default. These checks do not certify a production rollout.

The earlier migration runner record is documented in
[the migration and rollout document](./unified-product-catalog-v2-migration.md).
This run did not re-query the live Supabase project or collect production
traffic measurements.

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

## Production measurements still outstanding

No production Supabase query count, CPU, Egress, Realtime volume, or billing
sample was available in this run, so there is no production savings estimate.
The local PGlite migration simulation is not a substitute for those metrics.
Representative-store browser/iPhone measurements, signed TestFlight Release
verification, and the remaining gates are listed in
[the release and operations checklist](./unified-product-catalog-v2-release-gates.md).
