# Unified Product Catalog V2 sync protocol

## Compatibility

V1 remains available at `/api/mobile/products/catalog` for already released
clients. V2 is versioned at `/api/mobile/products/catalog/v2`; it uses the same
authenticated mobile gate, actor scope, and store revision source. V2 snapshots
and local stores carry an explicit schema version. A client never treats a
partial or invalid delta as a complete catalog.

## Full snapshot

The first request, a changed actor/role scope, an incompatible schema, a
corrupt/missing local catalog, or expired journal history returns a complete
actor-scoped snapshot. The server reads the current revision before and after
hydration and retries if the catalog changed during construction. A failed
consistent read returns an error; it does not return a partial success.

## Revision and delta envelope

```json
{
  "protocolVersion": 2,
  "mode": "delta",
  "revision": "166",
  "deltaSupported": true,
  "delta": {
    "baseRevision": "150",
    "revision": "166",
    "schemaVersion": 12,
    "userId": "…",
    "scopeId": "store:user:role",
    "upserts": [],
    "deletedIds": [],
    "metadata": {
      "categories": { "upserts": [], "deletedIds": [] },
      "brands": { "upserts": [], "deletedIds": [] },
      "suppliers": { "upserts": [], "deletedIds": [] },
      "warehouses": { "upserts": [], "deletedIds": [] }
    },
    "hasMore": false
  }
}
```

The example follows the implemented mobile route. Web server actions use the
same full/delta/unchanged modes and V2 delta builder. Catalog snapshots and
delta rows use schema version **12**.

Every journal entry has a monotonically ordered store revision and an explicit
change kind. Product upserts are full canonical product rows; product deletion
is a tombstone. Stock, unit, price, media, supplier-assignment, relationship,
and recent-sale changes identify the affected product IDs. Category, brand,
supplier, and warehouse edits carry metadata upserts/tombstones so clients can
rebuild local projections without downloading unrelated products. A role or
permission scope change invalidates the actor scope and requires a full snapshot.

## Bounded replay

The journal reader accepts a bounded page of at most 200 revisions and caps
affected products at 300. The API hydrates only the affected product IDs plus
changed metadata IDs. It returns the last contiguous revision as `revision`;
clients request the next batch from that revision while `hasMore` is true.
Web may combine bounded pages into one response. If a page is invalid,
oversized, incomplete, or cannot be hydrated consistently, the server falls
back to a complete snapshot; it does not return a truncated successful delta.

## Recovery

The server requires a contiguous retained revision range. If the client's
revision predates the retained floor,
there is a gap, a row is malformed, the schema differs, or a permission scope
does not match, the endpoint requires a full snapshot. The client stages a
delta, validates scope/schema/from-revision and duplicate/tombstone conflicts,
then commits rows and revision atomically. If apply fails, the last committed
revision remains usable and the client requests a full snapshot.

## Trigger invariants

- Business writes and journal events share one Postgres transaction.
- Rolled-back business writes cannot publish a catalog change.
- A row-level product/stock/price/unit change identifies affected product IDs.
- Order and purchase-document changes identify their affected line products;
  unrelated catalog products are not invalidated.
- Metadata-only changes update metadata/projections instead of forcing a full
  catalog transfer.
- Mass or schema-breaking changes may request full recovery explicitly.
- Retention is operator-triggered and never removes history before advancing
  the recovery floor.

## Diagnostics

Record only sync mode, revisions, counts, response bytes, duration, fallback
reason, and changed-row counts. Never include names, barcodes, customer data,
prices, or other product payloads in diagnostic logs.
