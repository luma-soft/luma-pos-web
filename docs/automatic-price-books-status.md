# Automatic price books and valuation transition

User decisions recorded on 2026-09-04:

- Exactly three system books: Giá Chung (product retail price), Giá vốn (product inventory cost), Giá Chưa Chiết Khấu (known gross purchase price). System names, metadata, formulas and price overrides are immutable; custom books remain editable.
- Merge the separate last-purchase column into Giá Chưa Chiết Khấu. Zero is a valid price. Missing gross is null, labelled Chưa có dữ liệu, and cannot be selected to sell; never substitute retail or cost.
- Only owner/manager can select internal cost/gross books. Manual invoice-line prices/discounts keep the existing authorization rules.
- Target inventory valuation is moving weighted average. Allocate invoice discount by line value after line discount; include VAT and inbound freight. Gross purchase price remains before those adjustments.
- The user explicitly chose full historical reconciliation before switching, rather than taking current stock/current cost as a new opening balance.

## Implemented and locally verified

Automatic-book schema/guards/RLS and web/mobile projections, readonly pricing administration, source-correct POS selection, missing-price/zero checks, alternate-unit multiplication, and freight storage/input/details. Migration 0126 adopts existing book IDs and seeds missing system books. Migration 0127 adds receipt freight without modifying recorded totals or product valuation.

The new purchase cost allocation/replay helper is tested but is not wired into receipt writes. Current inventory costs have not been converted. New freight is recorded in the receipt payable total; a default zero on an older database row does not prove historical freight was zero.

## Required before activation

After explicit user approval, migrations 0126 and 0127 were applied on 2026-09-04 with the tracked session runner and advisory-lock checks enabled. No migrations remain pending. Both stores have exactly one retail, cost and purchase system book. All 1,240 receipts have a valid freight field. Before/after fingerprints confirm cost, retail, gross purchase prices and total stock were unchanged. Targeted verification before applying passed 82 web tests and 24 mobile tests, TypeScript and Flutter analysis; web lint had no errors (one existing React Hook Form compiler warning).

Historical reconciliation remains pending the latest source bundle. Database mappings identify an August 30 export; only June exports are available locally. Read-only reconciliation resolved 206 archived SKUs and matched 4,329/4,330 June received lines. It identified 1,173 discounted lines covering 551 products where stored imported unit_cost is net while the gross source is the original Đơn giá. The import also records per-unit discount in the field native receipts treat as a line discount. Do not replay imported receipt values through the new calculator or backfill gross prices without source normalization and verification against the August source version.

Next steps after obtaining the latest source: reconcile the seven unmapped stocktake-only SKUs, source-version differences, stock/value anchors, return costs and freight links; normalize imported receipt price/discount semantics; reconcile later local movements; derive gross from the latest valid received document with unit conversion; replay weighted average with correct edit/cancel chronology. No current-cost opening anchor is authorized.

Local detailed audit artifacts are in tmp/price-cost-reconciliation/source-reconciliation.md and db-reconciliation.md, with per-row JSON evidence. Raw-only June counts are provisional; the DB report supersedes its missing-SKU counts.
