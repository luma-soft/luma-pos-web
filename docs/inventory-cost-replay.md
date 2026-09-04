# Inventory cost replay

The accepted transition uses available, reconciled KiotViet history. The user confirmed the revised sale replaces its previous version, explicitly skipped unavailable historical evidence, and confirmed historical inbound freight was zero. Unsupported historical valuations retain their existing declared cost. That retained balance starts prospective calculation; it does not certify earlier cost of goods sold.

## Runtime contract

- Receiving goods recalculates a moving weighted average from the remaining quantity and incoming landed value. Invoice discount is allocated by line value after line discount; landed value includes VAT and freight. Zero-cost receipts are valid. Nonpositive existing stock uses incoming unit cost for the next positive receipt.
- `inventory_cost_baselines` records a tenant/product opening quantity, cost, raw gross purchase price and timestamp. Baselines are immutable in ordinary workflows. Explicit product cost edits append chronological `inventory_cost_adjustments` instead of deleting receipt history.
- Receipt changes replay the current received document lines and ordinary stock movements after the baseline. Purchase edit/cancel audit reversals are excluded because current receipt state is authoritative. Base-unit conversion applies to both quantity and cost. A draft is valued at actual receipt time, not its draft creation date.
- Customer returns restore original sale cost when that sale is inside the replay period. Returns of older sales with unknown original cost preserve the current average. Cancelling a return removes its effect. Order edits and cancellations restore actual outstanding physical stock, including combo components, and write real quantity movements.
- Receipt quantity, value, warehouse changes and cancellation are blocked for receipts already included in the opening balance. Notes, invoice information, supplier and payment edits retain original lines and original total rounding.
- Legacy KiotViet receipts store net unit price and per-unit discount; native receipts store gross unit price and total line discount. Historical rows remain unchanged and are outside the replay period. A future historical reopening must normalize from source provenance before replaying those rows.
- Replayed quantity must equal the current product stock. A mismatch rolls back the write rather than publishing an unexplained valuation. Tenant checks, product locks and database timestamp precision protect the transition boundary.

Raw `products.last_purchase_price` remains the latest known gross receipt cost. The separately editable company list book has independent `product_prices`; valuation never updates it. The displayed latest net receipt price is handled by the pricing workflow.

## Transition evidence and recovery

Migration 0128 creates the accounting tables, tenant foreign keys, internal-only access rules, receipt effective time and stock-event clock timestamps. It does not change existing product valuations. The tracked migration runner retains its session and advisory-lock checks.

The one-off data operation has a read-only default, exact workbook hashes, source row provenance, a reviewed product allowlist, local before/after backups and resumable stock markers. It preserves unrelated local activity and financial balances. Payment-only source changes are deferred for a coordinated financial reconciliation; a scoped zero-diff result is not a full financial import.

Detailed identities, counts, amounts, source workbooks and applied snapshots are local audit artifacts under `tmp/price-cost-reconciliation/`; do not publish them. Full historical COGS certification, deleted-identity recovery and unsupported history are outside the accepted transition.

## Verification

Real PGlite checks cover weighted allocation, zero values, converted units, receipt editing/cancellation with intervening sales, manual overrides, microsecond cutoffs, original return costs, return cancellation, repeated order edits, physical combo restoration, tenant isolation and rollback on stock drift. Action-level receipt checks exercise the write boundary. TypeScript and affected ESLint checks run on the integrated state before publishing.
