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

## Catalog Revision

The Catalog Revision is a database-owned monotonic number. Any insert, update,
or delete that changes product identity, units, prices, Warehouse Stock,
warehouses, categories, or brands advances it. Clients compare this lightweight
number with their Catalog Snapshot and replace the snapshot when it changes.
Callers do not manually decide which mutations invalidate the Product Catalog.

## Warehouse Stock

Warehouse Stock is the quantity, reserved quantity, and minimum level of one
product in one warehouse. It is included in the Catalog Snapshot for display
and product selection; stock mutations remain server-authoritative.
