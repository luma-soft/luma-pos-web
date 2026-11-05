# Unified Product Catalog V2 test report

## Status

Implementation and local verification are complete. The V2 feature is not
deployed, and the SQL migration has not been applied to production.

## Verification

- Web catalog, delta, explorer, ranking-parity, and unit-search suites: **18/18
  passed**. Bun is unavailable in this environment, so the Bun-compatible tests
  ran through a temporary Node.js shim.
- PostgreSQL migration simulation with PGlite: **3/3 passed**.
- ESLint on changed web files: passed.
- TypeScript source check: passed.
- Next.js production build with Webpack: passed and generated 150 static pages.
  The build printed non-fatal warnings for missing `metadataBase`, three
  existing `fit-content` width declarations, and the `libheif-js` dynamic
  dependency.
- Native iOS focused XCTest selection: **7/7 passed**. The full test target
  could not be compiled as-is because four unrelated existing test source files
  contain stale compile errors; those files were excluded for the focused run.
- Native iOS Debug build: passed. The updated app was installed and launched on
  the already-booted iPhone 17 Simulator.
- `git diff --check`: passed in both repositories.

## Synthetic search benchmark

These are single-run Node.js microbenchmarks over the same generated product
catalog. Exact search is measured separately from a broad query returning the
first 20 ranked matches. They are not browser screen-open timings.

| Products | Previous exact | Previous broad, limit 20 | V2 exact | V2 broad, limit 20 |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1.93 ms | 0.03 ms | 4.44 ms | 4.31 ms |
| 10,000 | 13.44 ms | 0.02 ms | 32.40 ms | 26.98 ms |
| 50,000 | 51.95 ms | 0.02 ms | 155.88 ms | 139.79 ms |

The previous broad-search implementation stopped after finding 20 rows. V2
scores the complete matching set before applying the limit so exact codes and
names rank ahead of weaker matches regardless of row order. The benchmark
therefore shows the cost of the correctness change as well as the larger search
set; it is not an apples-to-apples proof of a speedup.

The automated V2 delta-apply benchmark measured **0.65 ms**, **5.31 ms**, and
**23.90 ms** at 1,000, 10,000, and 50,000 products, respectively.

The native synthetic benchmark before the final product-name normalization
optimization measured **75 ms**, **730 ms**, and **3,637 ms** at those same
sizes. The focused suite passed after the optimization, but its timing could not
be extracted from the Xcode result bundle in this environment; no post-change
native timing is claimed.

## Not measured

No production traffic or database was used. API request counts, response bytes,
Realtime volume, warm screen-open latency, memory use, Supabase query/CPU/billing
changes, and any numeric savings estimate remain unmeasured. The web migration
simulation is local only; do not treat these results as a production migration
or deployment record.
