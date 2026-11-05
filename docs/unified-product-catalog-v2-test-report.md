# Unified Product Catalog V2 test report

## Status

The web and iOS implementation PRs are merged into `main`. Pending database
migrations were applied through the migration runner to the database configured
by `DATABASE_URL`; the runner recorded them in `_migrations`. The iOS Release
client still requires the V2 feature flag or in-app override, so this report
does not claim broad end-user rollout or production performance savings.

## Verification

- Focused web catalog, delta, explorer, route, and migration suite: **24/24
  passed**. Bun is unavailable in this environment, so the Bun-compatible tests
  ran through a temporary Node.js shim.
- PostgreSQL migration simulation with PGlite: **3/3 passed**.
- V2 API route, bulk statement-journal, and line-order preservation regressions:
  **10/10 passed** in the focused Node/PGlite run.
- The configured database has all V2 journal columns and **24 statement-level
  triggers** across the eight high-volume tables (insert, update, and delete
  triggers per table). The migration tracker contains `0144`, `0147`, `0148`,
  `0149`, and `0150`.
- ESLint on changed web files: passed.
- TypeScript check over application source (excluding tests): passed. The
  repository-wide check still reports unrelated existing test errors in
  `src/lib/media/client.test.ts` (`bun:test` types are unavailable) and
  `src/lib/pos/price-book-switch.test.ts` (stale fixture properties).
- Next.js production build with Webpack: passed and generated 150 static pages.
  The build printed non-fatal warnings for missing `metadataBase`, three
  existing `fit-content` width declarations, and the `libheif-js` dynamic
  dependency.
- Native iOS focused XCTest selection: the earlier catalog suite passed
  **7/7**, and the latest persistence plus synthetic-size selection passed
  **2/2**. The full test target still has stale compile errors in unrelated
  existing tests; `NativeCustomerOfflineParityTests.swift`,
  `NativeSyncProgressTests.swift`, and `LumaPOSNativeTests.swift` were excluded
  for the latest focused run.
- Native iOS Debug build: passed. The updated app was installed and launched on
  the already-booted iPhone 17 Simulator.
- Development diagnostics now record web sync mode/revisions, changed entities,
  serialized response bytes, hydration/search/IndexedDB duration, and duplicate
  revision-check coalescing. Native OSLog records sync request count,
  mode/revisions, estimated response bytes, changed/deleted product counts,
  fallback reason, hydration/search duration, duplicate refresh coalescing, and
  actual SQLite row writes/deletes. No production sample has been collected.
- `git diff --check`: passed in both repositories.

## Synthetic search benchmark

These are single-run Node.js microbenchmarks over the same generated product
catalog. Exact search is measured separately from a broad query returning the
first 20 ranked matches. They are not browser screen-open timings.

| Products | Previous exact | Previous broad, limit 20 | V2 exact | V2 broad, limit 20 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1.93 ms | 0.03 ms | 3.75 ms | 3.28 ms |
| 10,000 | 13.44 ms | 0.02 ms | 40.26 ms | 29.70 ms |
| 50,000 | 51.95 ms | 0.02 ms | 201.69 ms | 151.06 ms |

The previous broad-search implementation stopped after finding 20 rows. V2
scores the complete matching set before applying the limit so exact codes and
names rank ahead of weaker matches regardless of row order. The benchmark
therefore shows the cost of the correctness change as well as the larger search
set; it is not an apples-to-apples proof of a speedup.

The latest automated V2 delta-apply benchmark measured **0.62 ms**, **3.61 ms**,
and **21.01 ms** at 1,000, 10,000, and 50,000 products, respectively.

The native synthetic benchmark before the final product-name normalization
optimization measured **75 ms**, **730 ms**, and **3,637 ms** at those same
sizes. The focused suite passed after the optimization, but its timing could not
be extracted from the Xcode result bundle in this environment; no post-change
native timing is claimed.

## Not measured

No production traffic was used for performance measurement. Production API
request/response volume, Realtime volume, warm screen-open latency, memory use,
Supabase query/CPU/billing changes, and any numeric savings estimate remain
unmeasured.
The PGlite migration simulation is local; the separate database migration run
is recorded in [the migration and rollout document](./unified-product-catalog-v2-migration.md).
