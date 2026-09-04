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

The latest user-supplied KiotViet workbooks have been audited read-only against a fresh database snapshot. The application bundle passes header/document financial validation. Source files remain unchanged. Detailed source counts, product identities, quantities and financial comparisons are retained in local audit artifacts, not this published status note.

The audit distinguishes new source activity, revised documents and source-independent local activity. Resolve revision identity before treating a changed document code as a new transaction. Preserve local products and never replay previously imported quantities a second time. No source data was written to the database during this audit.

Internal-use history is now included in source reconciliation. Some historical quantity observations still require stock-card/change-history evidence. Deleted source identities without exact mappings remain separate; stripping a deletion suffix is not sufficient identity evidence. Updated source evidence supersedes earlier source-version discrepancies.

Source receipt semantics are verified: gross Đơn giá minus per-unit Giảm giá equals net Giá nhập. The importer currently stores net unit_cost plus per-unit discount, while native receipts expect gross unit_cost and a line discount. Normalize provenance and units before replaying or changing this representation. Latest-receipt gross candidates are prepared locally with source provenance and base-unit conversion. Missing gross remains null; explicit zero is valid. Multiple gross prices within one receipt require an explicit aggregation rule. These are un-applied source candidates, not a completed live backfill.

Historical valuation is still not certified. Stocktake values and internal-use costs provide additional historical evidence; missing valuation cells remain null. Existing historical value observations must be used before asking the user for missing values. Preserve declared legacy cost for no-history products per the accepted decision, and distinguish zero ending stock from positive-stock valuation dependencies. Purchase-only diagnostic cost differences are conditional, not proven source errors: they omit historical cost edits, returned-stock original cost, stocktake valuation initialization and unprovided freight. Default database zeros do not establish that historical freight was zero.

Next steps: obtain stock/cost change history for residual quantity cases and deleted-product identities; resolve sale revision lineage and freight-to-receipt links; normalize imported receipt semantics; reconcile local history; derive gross from the latest valid received document across both source and local history; replay weighted average with correct return/edit/cancel chronology. No current-cost opening anchor or valuation activation is authorized by providing the files.

Latest local audit evidence is in tmp/price-cost-reconciliation/2026-09-04-review.md, 2026-09-04-source/report.md, 2026-09-04-db-source-comparison.json and 2026-09-04-stock-delta-explanations.json. Source files remain unchanged; hashes, actual sheet names and cell references are retained. These September results supersede the June provisional counts.
