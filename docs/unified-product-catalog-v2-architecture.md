# Unified Product Catalog V2 architecture

## Goal

The canonical product projection is the local read model for ordinary
browsing. POS, Inventory, document pickers, and web product management share
one actor-scoped catalog and one ProductExplorer contract. Server reads remain
for synchronization, metadata that is outside the product catalog, and
authoritative business operations.

## Read model

The versioned catalog contains product identity and lifecycle, legacy and
native variant relationships, product attributes/specifications, units and
unit prices, role-filtered price books, warehouse stock/reservations/minimums,
cost fields allowed by role, combos, media references, VAT, and recent sale
ordering. Category, brand, supplier, warehouse, and relationship metadata are
represented independently so renames and membership changes can be delivered
without retransmitting unrelated product records.

Inventory's grouped list is a projection over the same product rows. Its
grouping rule continues to include both `parentProductId` and legacy
`relatedProductId`; POS and document selectors retain separate selectable
unit rows where the workflow needs them.

## Sync ownership

- One coordinator runs per `(storeId, userId, effectiveRole)` scope.
- Web IndexedDB and iOS SQLite are persistent local stores. Each process also
  holds one in-memory read model and builds search indexes away from UI render
  work.
- Screens observe the local read model and do not request full product pages.
- The coordinator checks a lightweight revision at startup, foreground/resume,
  and a bounded fallback interval. Realtime is one scoped invalidation channel
  per signed-in web provider; it signals a revision and carries no product
  payload.
- Concurrent sync attempts share one in-flight operation. Cross-tab web sync
  uses the browser lock and BroadcastChannel. iOS actor isolation serializes
  publication.
- A delta is staged and persisted atomically with its committed revision. A
  malformed delta, revision gap, expired journal, unsupported schema, invalid
  permission scope, or corrupt cache leaves the old committed catalog visible
  and starts a full recovery.
- High-volume product and document-line tables use statement-level transition
  triggers. Each SQL statement writes one revision/event per affected store and
  carries the deduplicated product IDs; V1 receives a full marker for a
  multi-product statement while V2 can replay the targeted ID set.

## ProductExplorer

ProductExplorer owns normalization, candidate matching, ranking, filter
semantics, sorting, group projection, unit expansion, and local pagination.
Platform views supply display-specific controls and formatting. Search ranks the
complete filtered candidate set before pagination; exact SKU/barcode and exact
name matches retain the existing web POS priority, followed by prefix/token
matches and deterministic source-order ties. Vietnamese diacritics normalize
consistently.

## Web

The authenticated layout owns `ProductCatalogProvider`. All product browsing
uses its local snapshot and revision-aware subscription. IndexedDB persists the
catalog under the store/user/role scope and cross-tab updates install only a
newer committed revision. Product management may use privileged product detail
queries for editing, but list search, filtering, sorting, grouping, and paging
are local.

## iOS

After authentication, the application opens SQLite, loads the canonical local
catalog, prepares indexes off the main actor, and publishes readiness before
network revision checks. SQLite row changes and revision advancement share a
transaction. POS and Inventory projections are derived from canonical product
rows and preserve their existing offline drafts and checkout metadata.

## Business validation

The local catalog is not authoritative for sale, purchase completion, stock
adjustment, reservation, payment, price approval, or offline mutation replay.
Those operations keep current server-side validation, idempotency, tenant
checks, and transactional rules. They validate only selected product IDs and
required business data where existing APIs support it.

## Rollout

The V2 path is versioned and feature-flagged. Deploy additive backend schema
and APIs first, then web and iOS clients. Existing snapshots remain readable
until a successful V2 full snapshot is committed. Keep the V1 full endpoint
available for old clients during the rollout. Enable V2 for a controlled cohort
after parity and sync diagnostics are reviewed. Remove the paginated legacy
catalog path after the supported-client window ends.

## Consumer inventory

Web consumers now read and search the provider's in-memory/IndexedDB catalog:
POS, table orders, purchase creation and returns, internal use, stocktake,
order edit, inventory document actions, Shopee listing, service widgets,
installation and installed-asset batches, and Inventory product management.
The inventory management page's list, filters, sorting, grouping, and
pagination no longer call `getProducts()` on user input.

iOS consumers now read from `NativeSharedProductCatalogProvider`: POS,
Inventory's grouped/flat product list, purchase and return editors, internal
use, stocktake and stocktake attention, combo creation, customer sales-history
filters, invoice and return filters, unit summary, and service-project asset
selection. These screens do not own product-list requests. They request a
refresh from the shared coordinator when the catalog is missing or stale.

## API request matrix after implementation

| Surface | Screen open, search, filter, sort, pagination | Shared synchronization | Requests that remain |
| --- | --- | --- | --- |
| Web POS, Inventory management, and product pickers | 0 product-list requests; local ProductExplorer over the scoped catalog | One provider uses the V2 server action for revision/delta/full recovery | Checkout, document mutations, and selected-product/detail operations still use their authoritative APIs |
| iOS POS, Inventory, and product pickers | 0 screen-owned product-list requests; local provider projections | One actor-scoped coordinator uses `/api/mobile/products/catalog/v2` by default in Release builds | POS metadata/checkout APIs remain; the coordinator retains its paginated V1-compatible sync path for rollback |
| Older mobile clients | Existing behavior | Existing `/api/mobile/products/catalog` route remains available | Compatibility contract is unchanged |

The iOS V2 gate is enabled by default in Debug and Release builds. Release
builds can still use the per-device override or `luma.catalog.forceLegacySync`
to roll back to the legacy sync path. Both paths are owned by the shared
coordinator; turning V2 off does not restore per-screen product browsing. The
source default affects newly built apps and does not update installed clients.

The implementation removes per-screen product-list reads. It does not claim a
measured reduction in database CPU, response bytes, or Supabase billing; those
require a production-like workload and server-side telemetry.
