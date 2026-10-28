# Supabase egress and storage review — 2026-10-28

## Summary

The clearest avoidable egress is repeated catalog and screen data. Web already
has a revisioned IndexedDB catalog, but a revision change downloads the entire
catalog. Native POS also starts a paged full-catalog download on each POS load,
even though it fetches and stores the revision separately. Web KDS refreshes
its server-rendered data every 20 seconds. Mobile product pages also return
catalog filters and all active promotions on every page request.

The performance review also found a costly per-product purchase-price query,
duplicate full-catalog storage in the native POS cache, and full-size product
images used in thumbnail rows. The local query history shows the catalog
projection averaging roughly one second per call, though those measurements
are from a different project than the new production project.

This review is read-only. It did not change application code or run tests.
Storage size, device disk use, and egress are separate measurements. Supabase
counts traffic from Database, Auth, Storage, Realtime, Edge Functions, and the
pooler as egress. The prior-project usage note records 6.794 GB against a 5 GB
allowance and HTTP 402 restrictions. See [Supabase's egress guide](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

## Findings, ordered by expected impact

### P1 — A stock change causes a full web catalog download in every active tab

The web provider polls the catalog revision once a minute while visible and
also subscribes to Supabase Realtime. When the revision changes it invokes
`syncProductCatalog`, which constructs the complete active-product snapshot.
The snapshot query returns product names, descriptions, specs, prices, unit
definitions, warehouse stock, image URLs and other fields for every active
product. Stock-level writes advance this same revision, so routine stock
activity can make every open tab fetch the full catalog again. The polling
fallback also repeats a revision request in addition to the Realtime channel.

Evidence: [product-catalog-provider.tsx](/Users/cvthien/project/LumaPOS/luma-pos-web/src/components/product-catalog-provider.tsx:32), [product-catalog.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/product-catalog.ts:40), and migration `0104_tenant_catalog_and_storage.sql` (stock-level writes bump the revision). Local `pg_stat_statements` includes two matching full-product projections with 704 and 681 calls, returning about 4.06 million rows combined since its July 4 reset. This is cumulative row count, not bytes, and the statistics do not prove which deployed project or users generated each call.

Recommendation: prioritize a smaller catalog wire projection and avoid refetching unchanged data across tabs. If moving to incremental sync, first add a reliable change feed for stock, prices, product identity and promotion windows; product `updated_at` alone does not cover all invalidation sources. Reduce or back off the 60-second revision fallback when Realtime is connected, while retaining a recovery path.

### P1 — Native POS downloads all product pages again on each POS load

`POSStore.performLoad()` requests its POS seed, then `startFullCatalogRefresh()`
fetches the catalog revision and paginates every product page. It does not
compare the fetched revision with the persisted catalog revision before
fetching those pages. Reopening POS therefore transfers the full product
catalog even when it has not changed. The separate
`NativeProductCatalogSyncCoordinator` already demonstrates a revision check
that skips its full browse sync when the cached revision matches.

Evidence: [POSStore.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSStore.swift:569), [POSStore.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSStore.swift:702), and [NativeProductCatalogSync.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Inventory/NativeProductCatalogSync.swift:134).

Recommendation: pass the revision into the full refresh and compare it with the
revision stored with the POS snapshot. Skip the page loop on a match; keep the
existing authoritative price and promotion refresh required by checkout.

### P1 — POS project options are not scoped to the signed-in store

`getPosData(storeId)` scopes its product and customer queries, but its active
projects query filters only by `status`. The mobile endpoint returns those
project rows to the authenticated caller. Since this uses the server's Drizzle
database connection, verify row-level security is not being relied upon to
scope this query. As written, projects from other stores can enter this
response, creating a tenant data exposure as well as unnecessary transfer.

Evidence: [pos.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/pos.ts:272) and [mobile POS route](/Users/cvthien/project/LumaPOS/luma-pos-web/src/app/api/mobile/pos/route.ts:9).

Recommendation: constrain the query by `projects.storeId = storeId` and review
other direct database queries for the same missing tenant predicate. Treat
this as a correctness and tenant-isolation fix, independent of egress work.

### P2 — Mobile product list repeats static filters and promotions per page

Each `/api/mobile/products` request reads price books, all active promotions,
and category, brand and supplier options. Native catalog sync requests pages
of 100 products and includes those collections in every response, although it
only needs them once for the completed snapshot. Repeated promotion tiers and
filter options increase both database reads and response bytes as page count
grows.

Evidence: [mobile products route](/Users/cvthien/project/LumaPOS/luma-pos-web/src/app/api/mobile/products/route.ts:30), [products data](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/products.ts:782), and [native product sync](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Inventory/NativeProductCatalogSync.swift:147).

Recommendation: return options, price books and promotion metadata only on the
first page or a separate revisioned endpoint. Preserve refresh behavior for
promotion time windows, which can change without a catalog write.

### P2 — Mobile POS builds larger datasets than its response uses

`getPosData` fetches up to 200 root products, their variant children, 500
customers and 300 projects. `getMobilePosData` later returns only 30 products,
100 customers and 100 projects. Rows beyond those limits still travel from
Postgres through the Supabase pooler to the app server, then get discarded.

Evidence: [pos.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/pos.ts:207), [pos.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/pos.ts:231), and [pos.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/pos.ts:309).

Recommendation: apply response limits in SQL and query only the required
product roots and children. Paginate customer/project lookup rather than
loading lists that the POS response immediately truncates.

### P2 — Web KDS rerenders and reloads its full server route every 20 seconds

Every open KDS screen calls `router.refresh()` three times per minute. That
reruns the dynamic page, store settings lookup, active ticket query and active
ticket-item query just to update the on-screen elapsed-time clock. It can
create 180 route refreshes per open screen per hour, before user actions.

Evidence: [kds-board.tsx](</Users/cvthien/project/LumaPOS/luma-pos-web/src/app/(app)/kds/kds-board.tsx:28>), [KDS page](</Users/cvthien/project/LumaPOS/luma-pos-web/src/app/(app)/kds/page.tsx:20>), and [kitchen.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/kitchen.ts:24).

Recommendation: update the clock locally without refreshing server data. Fetch
ticket changes on a longer interval or through a narrowly scoped change feed,
and pause refresh while the page is hidden.

### P2 — Supabase product Storage still contains a material set of files

The local database reports 598 objects in the `products` Supabase Storage
bucket totalling about 84.3 MB, alongside R2 media metadata with 454 ready
objects. The repository has an R2 migration and read paths, but local
`.env.local` has no R2 credentials/configuration and its Supabase project does
not match the new project ref recorded in the project-switch note. These
figures describe that local configuration only; they do not establish which
files are served in production or how much egress they produce.

Evidence: [media migration runbook](/Users/cvthien/project/LumaPOS/luma-pos-web/docs/media-r2-migration-runbook.md), [storage provider selection](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/media/storage.ts:12), and [project switch note](/Users/cvthien/project/LumaPOS/luma-pos-web/docs/supabase-project-switch-2026-10-28.md).

Recommendation: first confirm production `SUPABASE_URL` and `DATABASE_URL`
target the intended new project and that its R2 write/read settings are enabled.
Then use Supabase Usage to separate Storage egress from Database and Shared
Pooler egress. Do not delete the remaining source objects without completing
the runbook's reference, fallback-read and rollback gates. For images that
remain on Supabase Storage, use appropriately sized thumbnails and stable cache
headers; the database list should carry image URLs, not image bytes.

### P3 — Local mobile caches have no byte or age bound

The native product-image cache prunes only when it exceeds 200 files, so 200
large originals can use substantial device disk. Invoice-history responses
are stored by full query key, with no expiry or pruning path visible in the
cache store. This is device storage rather than Supabase egress, though a cache
that cannot retain useful entries can indirectly cause more refetches.

Evidence: [LumaImageViewer.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Shared/LumaImageViewer.swift:181), [POSDraftPersistence.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSDraftPersistence.swift:143), and [InvoiceHistoryCache.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Invoices/InvoiceHistoryCache.swift:14).

Recommendation: cap image-cache bytes and store thumbnails for list views.
Give invoice-history cache a bounded retention policy and retain only recent
query keys per actor.

## Performance follow-up review

### P1 — Per-product latest purchase-price calculation is a database hotspot

The product catalog and mobile product queries include
`lastPurchaseNetPriceSql()` in their select projection. That expression runs a
correlated lookup of received purchase lines, recalculates each receipt's
discount allocation, and orders by its effective date for each product row.
The callers later null this field for roles that cannot view purchase prices,
after the database has already done the calculation. This adds work to every
catalog row and can add repeated reads of purchase history to large list
queries.

Evidence: [last-purchase-net-price.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/pricing/last-purchase-net-price.ts:8), [product-catalog.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/product-catalog.ts:71), and [mobile products route](/Users/cvthien/project/LumaPOS/luma-pos-web/src/app/api/mobile/products/route.ts:66). The local database's cumulative query statistics contain full-catalog shaped projections averaging about 1.08–1.12 seconds per call, plus related product queries averaging about 0.6–3.5 seconds. They include product, stock, order, purchase and price data. These figures come from the project mismatch described below, so use them as a lead for profiling, not as production timings for the new project.

Recommendation: omit this calculation from projections for roles that cannot
see the value. For authorized roles, calculate latest net purchase prices in a
bounded batch by product/page, or maintain a verified projection if write and
rollback semantics permit it. Measure query plans and response time on the new
project before choosing an index or changing the pricing formula.

### P2 — Native POS serializes and stores the complete catalog twice

The native cache first encodes the complete `POSCatalog` into one JSON value,
then writes each product again into `catalog_products`. On restore it decodes
the complete JSON catalog and also loads the per-product rows. During a full
refresh, the app holds the old catalog, all fetched pages, the assembled new
catalog, and encoded product/catalog data while replacing the cache. Writes
also prepare a per-product query and parse/merge JSON inside one SQLite write
transaction. This increases local database size, startup decoding time, and
peak memory during catalog refreshes.

Evidence: [POSDraftPersistence.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSDraftPersistence.swift:197), [POSDraftPersistence.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSDraftPersistence.swift:213), [POSDraftPersistence.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSDraftPersistence.swift:287), and [POSStore.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/POS/POSStore.swift:745).

Recommendation: choose one canonical product representation in SQLite. Keep
the small catalog metadata blob limited to warehouses, customers, price books,
promotions and checkout settings; load product rows from the indexed table.
Use one prepared upsert for the batch and avoid reading/merging existing JSON
for rows that a verified full snapshot replaces.

### P2 — Shared product-form options materialize product images and stock for the whole catalog

`getProductFormOptions()` returns every non-parent, non-combo product with
specs, prices, stock, and a correlated image-URL aggregation. It is used by
products, pricing, stock, and tables pages and cached for only 60 seconds. The
tables caller needs categories; product and pricing forms use options and
product lookup separately. Returning and caching full product rows in this
shared options payload creates avoidable database work and server memory use.

Evidence: [products.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/products.ts:995) and its callers in [product tabs](</Users/cvthien/project/LumaPOS/luma-pos-web/src/app/(app)/inventory/tabs/products.tsx:91>), [pricing](</Users/cvthien/project/LumaPOS/luma-pos-web/src/app/(app)/inventory/tabs/pricing.tsx:41>), and [tables](</Users/cvthien/project/LumaPOS/luma-pos-web/src/app/(app)/tables/page.tsx:43>). The local query history includes a similarly shaped image-and-stock product projection returning roughly 2.6 million rows across 766 calls, averaging about 580 ms; confirm the query mapping with production logs before treating that count as this function's exact traffic.

Recommendation: split compact form options from product search. Fetch products
only when a picker opens or its search changes, page the results, and omit
image and stock projections when those fields are not rendered.

### P2 — Product list thumbnails request and decode original images

Managed product-image URLs are built from `media.object_key`, not
`thumbnail_object_key`. The native inventory row renders those URLs in a 64 pt
thumbnail, while `LumaImageView` downloads the full response and constructs a
`UIImage` from the original bytes. Large product photos therefore cost extra
network transfer and decoded memory even when only a small preview is visible.

Evidence: [product-media-read.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/products/product-media-read.ts:55), [InventoryProductThumbnail.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Inventory/InventoryProductThumbnail.swift:25), and [LumaImageViewer.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Shared/LumaImageViewer.swift:70).

Recommendation: return a thumbnail URL for list rows and reserve the original
for the detail viewer. Downsample before retaining decoded pixels, and bound
the image cache by bytes as well as file count.

### P3 — Offline product browse re-filters and sorts the whole snapshot for each search

When a network browse fails, `NativeProductCatalogSnapshot.page()` scans the
cached rows, recursively checks variant members and suppliers, and sorts the
entire filtered result before slicing one 30-row page. On a large catalog,
repeated search edits therefore redo full-catalog normalization and sorting on
the main browse flow.

Evidence: [NativeInventoryProductBrowseModel.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Inventory/NativeInventoryProductBrowseModel.swift:310) and [InventoryCatalogModels.swift](/Users/cvthien/project/LumaPOS/luma-pos-mobile-native-ios/native-ios/LumaPOSNative/Features/Inventory/InventoryCatalogModels.swift:202).

Recommendation: precompute normalized searchable text and stable sort keys
when loading the snapshot. Filter before sorting, and sort only the current
page when the selected ordering allows it. Profile with a production-sized
catalog before prioritizing this below server and image work.

## Production verification — 2026-10-28

The linked Vercel production project is `luma-pos-web`; its production
`NEXT_PUBLIC_SUPABASE_URL` resolves to the new project ref
`awomvgzxylucxjkkmmjp`. Vercel reports `DATABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` as encrypted production variables. Their values are
not readable with `env pull` or `env run`, so I did not use local credentials to
connect to production. After signing in to the Supabase Dashboard, I inspected
the project Usage and Query Performance pages and ran one read-only SQL query
for the `pg_stat_statements` reset timestamp.

The Usage page was filtered to project `LumaPos` for the current billing cycle
(2026-10-04 through 2026-11-04). It reports 0.124 GB of uncached egress out of
5 GB (2%), 0 GB cached egress, 84.5 MB database size (0.089/0.5 GB), 0 GB
Storage size, and 1 monthly active user. On 2026-10-28, the daily egress
breakdown was 116.646 MB Shared Pooler Egress (98.3%), 1.508 MB Auth Egress
(1.3%), 540.746 KB Realtime Egress (0.4%) and 1,014 bytes PostgREST Egress
(0.0%); no Storage Egress appeared. Supabase labels traffic through Supavisor
as Shared Pooler Egress and PostgREST traffic as Database Egress
([egress guide](https://supabase.com/docs/guides/platform/manage-your-usage/egress)).
The service breakdown identifies the dominant service, but does not attribute
those bytes to an individual SQL statement.

In Query Performance, filtered to role `postgres`, the dashboard reported 14
slow queries, a 100% database cache hit rate and 19.8 average rows per call.
The leading product-list projection ran 198 times, consumed 1m43s (61.5% of
the role's total query time), and selects `lastPurchaseNetPrice` with a
per-product receipt lookup, image/media JSON aggregates, variant/combo data and
stock calculations. Two other wide product projections consumed 18.54s across
7 calls and 13.49s across 12 calls; another consumed 10.71s across 35 calls.
The top SQL shape matches the shared `getProducts` / `getBaseProducts`
projection used by web inventory and the mobile products endpoint
([products.ts](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/data/products.ts:171),
[mobile products route](/Users/cvthien/project/LumaPOS/luma-pos-web/src/app/api/mobile/products/route.ts:30),
[latest net purchase-price SQL](/Users/cvthien/project/LumaPOS/luma-pos-web/src/lib/pricing/last-purchase-net-price.ts:8)).
It is strong evidence for prioritizing this projection, but Query Performance
does not expose response bytes per statement.

The read-only query returned `pg_stat_statements` reset time
`2026-10-27 21:04:44 UTC` (2026-10-28 04:04:44 in Vietnam). Query counts and
times above are cumulative since that reset, not historical averages. The
100% cache-hit figure is Postgres buffer-cache activity, not HTTP or egress
caching. The project overview showed Nano compute, CPU 2%, disk 19%, RAM 57%
and 12/60 connections at the time checked; this is a single snapshot, not a
trend.

The Supabase Advisor also flags RLS disabled on `public._migrations` and
`public.sepay_payment_sessions` as critical. This is a separate security item
to verify against grants and API exposure; no database settings were changed.

Vercel production request logs for the last 24 hours returned 19 records and no
error-level records. They included 6 `GET /login` responses (200), 4 `GET /`
redirects (307), and 2 `GET /api/public/store` responses (200); the rest were
one-off requests. These logs include neither response duration nor transferred
bytes, and this small sample cannot identify Supabase egress sources.

I temporarily isolated and then restored the local `.env.local`; it still
points to `qnazjwycsdaezamlejxn`. I left it unchanged because only replacing its
public Supabase URL/key would leave `DATABASE_URL` on a different project and
make local behavior inconsistent.

## Measurement caveat and next checks

The earlier read-only database checks used the workspace's existing
`DATABASE_URL`, which connects through a Supabase pooler and matches the local
Supabase API URL. That local project ref does **not** match the new production
API project ref above. The observed database size (about 86.8 MB), Storage
object totals and query statistics must not be presented as usage for the new
project. `pg_stat_statements` totals are cumulative since July 4, 2026 and
measure rows/calls/time, not egress bytes.

To attribute the previous project's 6.794 GB egress or establish a new
production baseline beyond this first day, keep collecting the same Usage and
Query Performance views across a representative workload. The first-day
uncached egress is 2% of quota; if roughly 0.124 GB/day persisted for a full
30-day cycle, that would be about 3.7 GB, or 74% of the 5 GB allowance. This is
only a linear scenario, not a forecast. Instrument server response bytes or
sample representative query result sizes to measure how much the wide product
projection contributes to Shared Pooler egress. Keep the local Supabase URL,
anon key and database URL on one project when updating local configuration.
Compare bytes returned, calls per user session, Storage egress and device cache
size separately.

## Implementation follow-up — 2026-10-29

The implementation now covers the actionable application changes in this
review: web catalog refreshes are coordinated across tabs and back off when
Realtime is available; native POS skips a full catalog download when its
revision is unchanged; POS projects are store-scoped; mobile catalog metadata
is sent once per snapshot and product results are bounded; KDS polling is less
frequent and pauses in hidden tabs; purchase-price work is role-gated and
batched; native catalog rows are canonical in SQLite; image and invoice caches
are bounded; native inventory uses thumbnail URLs and downsampled images; and
offline browse precomputes its search data. The SQLite catalog writer now also
reuses its prepared statements across each batch.

Product-form options now contain only categories, brands, and suppliers. The
combo-item picker requests searchable 50-row pages and does not transfer image
URLs or stock projections for the whole catalog; it loads details for existing
combo items separately so cost-price calculations continue to work.

Three items remain gated by evidence or production access:

- A catalog revision change still requires one full snapshot. Replacing that
  with deltas requires a complete change feed for stock, prices, product
  identity, and promotion windows; product `updated_at` alone is not a safe
  invalidation source.
- The production project showed 0 GB Storage size and no Storage egress in the
  reviewed billing cycle. The 598 objects previously found through local
  `.env.local` belong to the old project `qnazjwycsdaezamlejxn`, so no R2 copy,
  cutover, or source deletion was run. Follow the media runbook if production
  Storage usage changes.
- The Supabase advisor warnings for `sepay_payment_sessions` and
  `_migrations` were not changed. Vercel's production environment did not
  provide readable database credentials to the isolated check process, while
  `.env.local` still targets the old project. No production SQL was run; use a
  verified production session connection before addressing those warnings.

The changed web files pass ESLint. TypeScript still reports only the existing
`bun:test` type resolution and `priceBook` fixture errors in test files. The
native app rebuilt and reinstalled successfully on the booted iPhone simulator.
