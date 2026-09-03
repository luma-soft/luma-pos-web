# Product variants on web and mobile

Technical specifications and installation instructions belong in the product description. Attributes identify sellable SKUs. Only attributes with `createsVariants: true` participate in generation. Unit conversions remain a separate inventory concept.

## Identity and existing products

- A native group has a synthetic `is_variant_parent` record and real children linked by `parent_product_id`. The parent cannot receive stock or be selected as a sellable SKU.
- Imported KiotViet families retain their real root SKU and `related_product_id` links. The root is counted once. No product IDs, unit IDs or historical stock records are recreated.
- Attribute catalog IDs and stable value IDs identify combinations. Names are display values; renaming/reordering does not recreate rows or reset entered prices and stock.
- Metadata tables `product_variant_groups`, `product_variant_members`, `product_variant_group_attributes` and `product_variant_requests` are additive. Missing or ambiguous historical selections require explicit assignment. Sparse imported families do not automatically create missing SKUs.
- Migrations 0124/0125 add metadata and invalidate stale group editors. They do not repeat the earlier migration of descriptive specifications on 359 verified Luma-created products.

## Write contract

`saveProductVariantGroup` accepts the product form schema with:

- `variantContractVersion: 2`, an immutable `requestId` for each logical save and `variantOperation: create | edit | add`.
- Existing groups require their root `variantGroupId` and current `variantRevision`.
- Each attribute has `attributeId`, `values` and aligned stable `valueIds`.
- Each row has `combinationKey`, `optionValueIds`, identifying `specs` and its own commercial fields. Persisted rows also have `productId`; their `initialStock` must be zero or omitted.
- `excludedCombinationKeys` declares combinations deliberately not stocked.

The transaction validates tenant ownership, catalog references, membership, combination coverage and identity before committing products, opening stock and the retry receipt. An identical request retry returns the original result. A reused request ID with a different body is rejected. Conflicting edits require reloading the group.

Creating a group or extending one permits at most 200 new SKUs per operation. Existing larger imported groups remain editable. Their preview budget includes persisted members and exclusions; the server obtains those counts from locked database records rather than trusting client-supplied IDs.

Group edits update root common fields and explicit per-SKU commerce. Existing child description/image overrides, unit IDs, optional price nulls and unchanged lifecycle states remain intact. Root common fields are name, description, category, brand, suppliers and images. Other SKU settings use the single-SKU editor. Group add uses defaults for new SKUs; it does not rewrite existing common fields. New native children inherit their parent's description when they have no own description.

## Mobile compatibility

- `GET /api/mobile/products?variantContractVersion=2` opts into imported-family grouping. Older callers retain the flat imported-SKU list.
- `GET/POST /api/mobile/product-attributes` and `PATCH/DELETE /api/mobile/product-attributes/:id` reuse the existing catalog service and stock permissions. Used attributes cannot be deleted, including references from inactive products and variant metadata.
- `PATCH /api/mobile/products/:rootId` with `action: save-variants` uses the same group transaction as web.
- `GET /api/mobile/products/:skuId/stock-card` returns paginated real movements, balances and warehouse quantities. Synthetic parents are rejected.

## Runtime and release checks

Run the shared model, form reconciliation, group read, catalog and PGlite transaction tests; run TypeScript/ESLint and a production build. On mobile run Flutter analysis/tests and inspect the iPhone runtime, including opened pickers and keyboard dismissal.

For database migrations use the official tracked runner. Reuse `DATABASE_URL` credentials, derive the same-host session endpoint if needed and set `MIGRATION_DATABASE_URL` only for that process. Preserve session/advisory-lock checks. Compare product, unit, stock-level and movement hashes before/after; verify no migrations remain pending.

Before publishing, check the E/F fixture: E costs 1,280,000, sells for 1,490,000, stock 0; F costs 990,000, sells for 1,190,000, stock 2. Aggregate stock is 2. Also inspect a large imported family, mixed units, partial group selection and SKU-specific edit/receipt/stock-card actions.
