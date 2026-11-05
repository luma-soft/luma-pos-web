# Unified Product Catalog V2 Supabase optimization

## Baseline findings

- V1 delta replay is contiguous and capped, but changes from orders, suppliers,
  media, variant membership, and purchase documents currently write global
  `requires_full` events.
- V1 triggers are row-level for most tables, so multi-row mutations advance
  the revision and journal once per row.
- Web already has one provider per mounted authenticated/POS scope, browser
  locking, BroadcastChannel, one Realtime channel, focus/visibility checks, and
  bounded polling. The cache persists a full catalog blob after a delta.
- The Inventory product-management page queried its product list from the
  server as search/filter/page parameters changed. The implementation now
  derives that list and its filters locally from the shared catalog.
- iOS already stores actor-scoped SQLite product indexes, but applying a
  unified delta currently serializes full snapshots and replaces all POS index
  rows.

## V2 resource controls

- Read a lightweight revision first; transfer product data only when it
  differs.
- Return bounded delta pages and coalesce repeated entity updates within a
  batch.
- Keep ordinary stock, price, unit, media, relationship, and document-linked
  changes targeted to changed product IDs.
- Send category/brand/supplier/warehouse metadata separately and update local
  derived fields.
- Persist only changed IndexedDB/SQLite rows and the revision marker for a
  delta.
- Keep one actor-scoped sync coordinator and one Realtime invalidation source;
  screens do not subscribe or poll independently.
- Keep image bytes outside the catalog. Send only stable media references and
  changed references for affected products.
- Keep server validation for business operations and avoid full-catalog reads
  for documents containing a small set of selected products.

## Measurement plan

Collect per-run mode, revision before/after, changed product/metadata counts,
payload bytes, elapsed sync time, local hydration/search time, rows written,
rows deleted, duplicate sync requests prevented, and explicit full-fallback
reason. Use synthetic catalogs at 1,000, 10,000, and 50,000 products. Compare
full snapshot bytes and database reads with a three-product delta. Do not infer
Supabase savings from request counts alone; report measured query/response
counts separately from any estimate.

## Implementation outcome and measurement limits

Web list browsing and the iOS product browse model now use local catalog
projections; product list calls are owned by the shared sync coordinator. The
web provider persists only changed product rows for deltas. Native SQLite
applies changed catalog rows and tombstones in the same transaction as the
revision marker.

Synthetic local search and delta timings are recorded in
`unified-product-catalog-v2-test-report.md`. Warm screen-open time, memory,
full-snapshot versus delta bytes, Supabase query counts/CPU, Realtime volume,
and billing were not measured in this workspace. No numeric Supabase savings
estimate is reported.
