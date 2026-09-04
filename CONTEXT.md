# Domain context

## Product Catalog

The Product Catalog is the app-wide, read-only projection used to find and
select active products. It contains product identity, selling and cost prices,
units, category/brand metadata, and Warehouse Stock.

The Product Catalog is not authoritative for mutations. Workflows may use a
Catalog Snapshot to prepare input, but inventory and financial actions must
re-read authoritative database state inside their server transaction.

## Catalog Snapshot

A Catalog Snapshot is a user-scoped, versioned copy of the Product Catalog
stored in IndexedDB. The app reads it immediately when offline or during
startup, then refreshes it from the server when online.

Mobile stores the same role-scoped catalog in its local database, including
price-book options and currently active promotion tiers. Absent fields preserve
legacy API compatibility; explicitly empty collections clear stale metadata.

## Catalog Revision

The Catalog Revision is a database-owned monotonic number. Any insert, update,
or delete that changes product identity, units, prices, Warehouse Stock,
warehouses, categories, or brands advances it. Clients compare this lightweight
number with their Catalog Snapshot and replace the snapshot when it changes.
Callers do not manually decide which mutations invalidate the Product Catalog.

Migration `0130_pricing_catalog_revision.sql`, applied on 2026-09-04, extends
revision invalidation to price books and promotions.
Promotion time windows can change without a write/revision; mobile checkout
therefore refreshes pricing metadata even when the revision is unchanged.

## Checkout Pricing Expectation

New web/mobile create-order requests carry the accepted final price per selling
unit and conversion factor, ordered identically to the order lines. This is an
expectation, not permission to override prices. The server resolves authoritative
pricing in the order-writing transaction, then locks and rechecks the tenant's
Catalog Revision before any order/payment/stock write. A mismatch rolls back and
requires explicit review; offline conflicts retain their original payload.
The revision lock remains held through commit. Contention can conservatively
reject unrelated same-store activity, with bounded waits and safe rollback.
Legacy requests remain accepted without a client-price expectation; historical
quote conversion and subsequent payments retain their saved price semantics.

## Pricing Administration

Pricing lists and bulk formulas share one filter definition. Bulk changes span
all filtered pages but only mutate active, directly sellable SKUs with an
available source price. Missing prices are distinct from zero.

A unit-price change is either **Keep Separate Prices** or **Synchronize by
Ratio**. Synchronization is available only for the retail book, derives the base
price from the explicitly chosen unit, and clears that SKU's retail unit
overrides. It never changes other SKUs or writes another book's base price.
Pricing editors send their reviewed price/unit snapshot for transactional stale
write detection. See `docs/pricing-workflow.md` for the complete web/mobile rules.

## Warehouse Stock

Warehouse Stock is the quantity, reserved quantity, and minimum level of one
product in one warehouse. It is included in the Catalog Snapshot for display
and product selection; stock mutations remain server-authoritative.
