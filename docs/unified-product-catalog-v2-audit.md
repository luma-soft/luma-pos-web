# Unified Product Catalog V2 audit

Audit baseline: `main` fetched on 2026-11-05, before implementation. The web
repository started at `1ee9dabad27c1654e2469779347e0c6e541d3b42`; iOS started at
`ee924dc01196b02b1605d6d0ab65348e42580e39`. Both feature branches were created
from those commits.

## Backend and web

### Existing catalog path

- `src/lib/data/product-catalog.ts` builds a broad actor-scoped product
  projection. It includes product identity/status, variant and legacy related
  IDs, specs, media URLs, units, combos, price books, warehouse quantities,
  reserved quantities, purchase prices gated by role, and latest completed-sale
  timestamps.
- `src/app/api/mobile/products/catalog/route.ts` serves `full`, `delta`, and
  `unchanged` responses. The actor scope includes store, user, and role. It
  refuses unsafe delta replay and falls back to a complete snapshot.
- `src/lib/catalog-delta.ts` currently accepts only a contiguous sequence of
  product-ID events, at most 2,000 journal rows and 300 distinct products.
  Missing rows, a `requires_full` marker, or an oversized range forces a full
  snapshot.
- `drizzle/0142_catalog_delta_journal.sql` adds tombstones and a retention
  floor, but `bump_product_catalog_revision()` writes one event per trigger
  invocation. Product/unit/price/stock/combo/supplier-assignment events carry
  one product ID. Variant membership, media, supplier, orders, order items,
  purchase documents, and variant-group events are global invalidations.
- The full snapshot is revision-checked before and after hydration. The API
  fails closed if a consistent full snapshot cannot be built.

### Web cache and browsing

- `src/components/product-catalog-provider.tsx` is already mounted at the
  authenticated and POS layouts. It hydrates IndexedDB, keeps an in-memory
  snapshot, deduplicates refreshes, uses browser locks across tabs,
  BroadcastChannel for committed updates, one scoped Realtime subscription,
  and revision checks on focus/visibility/online plus bounded polling.
- `src/lib/offline/product-catalog-store.ts` stores the complete snapshot as a
  single IndexedDB value. Applying a delta therefore rebuilds and persists the
  full product array.
- Shared local catalog consumers found with `useProductCatalog()` are POS,
  table orders, purchase creation, purchase returns, internal use, stocktake,
  order editing, inventory document actions, Shopee listing, service widgets,
  installation batches, and installed-asset batches.
- The Inventory product-management page in
  `src/app/(app)/inventory/tabs/products.tsx` still calls `getProducts()` from
  the server on each query/filter/sort/page navigation. This is the remaining
  product-list query call site found in `src/app` and bypasses the shared local
  browsing engine.
- `searchProductCatalog()` in `src/lib/product-catalog.ts` performs normalized
  token containment but returns catalog order and truncates at the requested
  limit. POS separately expands product-unit candidates and ranks them in
  `src/lib/pos/search-unit-results.ts`. Backend POS search and iOS have separate
  ranking implementations, so parity is not guaranteed by a shared contract.

## Native iOS

### Existing catalog and sync paths

- `NativeSharedProductCatalogProvider` in
  `native-ios/LumaPOSNative/Features/Inventory/InventoryCatalogModels.swift`
  keeps one in-memory actor-scoped unified snapshot and derived Inventory/POS
  projections. It also keeps legacy browse and POS caches for compatibility.
- `NativeProductCatalogSyncCoordinator` in
  `Features/Inventory/NativeProductCatalogSync.swift` still has a separate
  paginated full-catalog sync path for compatibility and rollback. The unified
  `/catalog` endpoint is now enabled by default for newly built Release apps.
- Inventory first renders its local grouped projection when available, but
  `NativeInventoryProductBrowseModel` still calls the paginated browse API for
  unsupported filters, missing projections, and some online reconciliation
  paths. Its complete legacy refresh can fetch every page when the revision
  changes.
- POS restores its SQLite catalog before network work. `POSStore.performLoad()`
  still fetches checkout metadata; when the catalog is incomplete it can fetch
  product seed data, and it starts the shared full catalog refresh. Selected
  product detail refreshes remain separate from ordinary browsing.
- App startup warms the shared catalog after authentication. Mutation
  notifications coalesce at the shared provider, but release fallback can
  still use paginated full synchronization.

### SQLite, projections, and search

- SQLite already has actor-scoped `catalog_products` rows and indexes for
  product name/category/update/create time. POS product reads can use this
  table without decoding the full POS JSON blob.
- `saveUnifiedCatalogBundle()` atomically writes the full unified snapshot,
  full Inventory projection, and POS metadata/index. Every unified revision
  currently serializes the complete snapshots and calls `writePOSCatalog()`
  with `replaceProductSnapshot: true`, deleting and rebuilding all indexed POS
  rows even for a small delta.
- The unified schema is version 10. Delta application checks actor scope,
  schema, base revision, duplicate IDs, tombstones, and revision ordering, but
  it has only product upserts/deletions and carries warehouse metadata from the
  old snapshot.
- Search/filter implementations include POS unit matching, Inventory browse
  filtering, and `LumaProductSearchRelevance`. They run on background tasks,
  but are separate from the web engine. Inventory's grouped view intentionally
  supports `relatedProductId` families as well as `parentProductId` families.

## Consumer and request matrix at the audit baseline

| Consumer | Local catalog source | Network reads that remain |
| --- | --- | --- |
| Web POS | `ProductCatalogProvider` | Revision/delta sync; selected mutation validation and checkout |
| Web purchase, return, internal-use, stocktake, order-edit, table-order, service and Shopee pickers | `ProductCatalogProvider` | Revision/delta sync and workflow-specific authoritative operations |
| Web Inventory product-management list | Server `getProducts()` | Product rows and filters are queried on navigation/search/filter/page changes |
| iOS POS | Shared provider plus SQLite POS index | Checkout metadata; legacy complete paging when release unified sync is disabled or the cache is stale; selected-product reads as needed |
| iOS Inventory | Shared catalog for eligible local projections plus paged browse cache | Browse pages for unsupported/missing local projections; legacy complete refresh when revisions change |
| iOS document/product selection sheets | Shared provider for common POS and document seeds; some feature caches remain | Workflow-specific details and fallbacks; catalog sync runs through the shared provider |

## Main risks to address

1. Normal order, supplier, media, variant, and purchase-document writes can
   invalidate the complete catalog instead of describing affected products or
   metadata.
2. A small iOS delta still incurs full snapshot JSON serialization and a full
   rewrite of the indexed POS product rows.
3. Web Inventory product management still runs server product-list queries.
4. Search ranking and unit expansion differ by platform and consumer.
5. Two compatibility systems remain active on iOS, with the release feature
   flag defaulting to the old paginated catalog path.
6. Existing actors are properly scoped by store and user/role in the shared
   snapshot APIs. Scope changes and permission changes must continue to clear
   or reject stale local projections.

## Implementation outcome

The changes in this feature branch close the three primary findings above:
the web Inventory management list now reads the local catalog; product screens
use local provider/model search and pagination; and V2 deltas update only
changed web IndexedDB and iOS SQLite product rows. Web and native unit search
ranking now share equivalent rules and mirrored parity fixtures. The iOS
Release V2 feature gate now defaults on; its legacy paginated sync remains
coordinated centrally for compatibility and rollback.

The compatibility V1 catalog route and native legacy sync implementation
remain during rollout. Product detail, POS metadata, checkout, document
mutation, and other business APIs remain where they carry authoritative or
workflow-specific data. See the architecture and protocol documents for the
current request matrix and wire format.

Search timings were measured only against synthetic local catalogs. There is
no measured warm screen-open comparison, production request count, response
byte comparison, or Supabase resource/billing comparison in this implementation.
