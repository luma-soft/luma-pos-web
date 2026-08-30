# KiotViet Product Synchronization Design

## Goal

Synchronize the Hai Dang store's product catalog from a KiotViet product export while preserving LumaPOS-native products and historical document integrity. The KiotViet snapshot is authoritative for matched KiotViet products' master data, prices, units, business status, and stock.

## Scope

This change covers product master data only. It does not synchronize customers, suppliers, sales, purchases, orders, returns, purchase returns, or cash-book records. It does not apply any production database migration or product writes as part of implementation verification; production application remains a separately approved operation.

## Source semantics

- A row without `Mã ĐVT Cơ bản` is a base product and owns the product identity.
- A row with `Mã ĐVT Cơ bản` is an alternate unit of the referenced base product. Its `Mã hàng` is a unit SKU, not another product.
- `Mã HH Liên quan` on a base-product row identifies the KiotViet same-type group root. LumaPOS stores this separately from `parent_product_id`, because the referenced root remains a sellable SKU rather than becoming a synthetic variant parent.
- `Tồn kho` on the base row is the authoritative stock quantity in the base unit. Alternate-unit stock is another representation of the same stock and must never be added to the base quantity.
- `Đang kinh doanh = 0` maps to `is_active = false` and `lifecycle_status = archived`. Any other value maps to active.
- `Được bán trực tiếp` remains distinct from business status. LumaPOS has no equivalent product field in this scope, so it is reported but does not deactivate the product.
- `Giá bán` on the base row updates `products.retail_price`, which backs LumaPOS's default `Giá Chung` price book.
- `Giá vốn` updates `products.cost_price` and therefore the cost-based price book.
- `Giá bán` on an alternate-unit row updates `product_units.price_override`.
- LumaPOS-only custom price-book overrides remain unchanged because the supplied workbook contains no corresponding KiotViet price-book export.

## Identity and ownership

Base products are matched by exact, trimmed SKU within the target store. A generic `product_source_mappings` table records `(store_id, provider, external_id) -> product_id`, last-seen time, and deletion time. KiotViet uses provider `kiotviet` and the base SKU as `external_id`.

On initial adoption:

1. Every product whose SKU appears as a current KiotViet base SKU becomes KiotViet-managed.
2. A LumaPOS product whose SKU is a current KiotViet alternate-unit SKU is an erroneous legacy placeholder. It is archived and preserved for existing document references; its SKU is stored on the correct `product_units` row.
3. A non-unit LumaPOS product absent from the current master snapshot but present in the supplied KiotViet history is treated as a historical/deleted KiotViet product and archived.
4. A LumaPOS product absent from both the current KiotViet master snapshot and supplied KiotViet history is LumaPOS-native and remains untouched.

On later synchronizations, a product with a KiotViet source mapping that is not seen in the complete current snapshot is archived and its mapping receives `deleted_at`. A mapped product that reappears is synchronized and its `deleted_at` is cleared.

Physical deletion is not used. Historical products and unit placeholders can be referenced by invoices, purchases, returns, and stock movements. Archiving preserves those references and keeps the products out of active selling flows.

## Managed fields

For current KiotViet base products, the synchronization owns:

- SKU, barcode, display name, description, product kind, category, brand;
- base unit, cost price, retail price, VAT rate;
- weight, location, specifications, image URLs;
- active/lifecycle status;
- alternate units, including unit SKU, barcode, multiplier, price override, and source order;
- the KiotViet same-type relationship used by the product-detail related-products tab;
- combo components and component quantities;
- default warehouse quantity and minimum stock level.

The synchronization does not overwrite LumaPOS-native price-book overrides, supplier links, warranties, dimensions, batch configuration, or unrelated product metadata.

## Stock behavior

The current Hai Dang store has one default warehouse. The synchronizer sets that warehouse's product quantity to the KiotViet base-row snapshot. It writes the delta as an auditable stock movement:

- `init` for a newly created product with non-zero stock;
- `adjust` for an existing product whose quantity changes;
- no movement when the quantity is already equal.

The product and stock level update, movement insert, unit replacement, mapping update, and archive operations run inside one database transaction. A failed synchronization rolls back the complete product run.

## Safety and operation

The new CLI is dry-run by default. Database writes require both `--apply` and an exact `--store=hai-dang` target. Before applying, it validates that the source-mapping migration exists, exactly one default warehouse exists, product SKUs are unique, alternate-unit base references resolve, and combo components resolve.

Dry-run produces a deterministic summary for create, update, archive, preserve, unit-placeholder cleanup, stock deltas, and warnings. It must not write product data, mappings, stock balances, stock movements, or migrations.

## Verification

Pure behavior tests cover parsing, stock invariants, ownership classification, archive decisions, price preservation, unit mapping, status mapping, and combo parsing. A PGlite migration test covers tenant constraints, source-mapping uniqueness, RLS enablement, and alternate-unit SKU uniqueness. Type checking, focused tests, the full suite, and a dry-run against the supplied workbook provide completion evidence.
