# KiotViet Remaining Data Synchronization Program

> **Implementation note:** execute this program task-by-task with test-first development and a review checkpoint after each production dry-run. Do not apply production data while implementing or verifying the code.

**Goal:** Build and operate a safe, idempotent synchronization program for the seven remaining KiotViet workbooks without replaying historical inventory, debt, or cash side effects.

**Architecture:** Pure workbook parsers and domain planners produce deterministic actions. A store-scoped database adapter adopts/reconciles source-owned rows, records provenance, and enforces invariants inside one transaction per phase. A single CLI is dry-run by default and requires an exact store plus reviewed source hash for apply.

**Tech stack:** Bun, TypeScript, SheetJS, Drizzle ORM, PostgreSQL/Supabase, Bun Test, PGlite.

**Spec:** `docs/superpowers/specs/2026-08-31-kiotviet-remaining-data-sync-design.md`

## Global constraints

- The completed product sync is a prerequisite and must not be rerun implicitly.
- Preserve all LumaPOS-native records and fields not declared source-managed.
- Do not call operational sale, purchase, payment, return, stock, debt, cashbook, e-invoice, or notification actions.
- All source reads and database operations are store-scoped.
- `--phase=all` remains dry-run-only; production application is separately approved per phase.
- Never infer historical document deletion from workbook absence.
- Do not stage or modify the user's unrelated product-media worktree changes.

---

### Task 1: Add the provenance, audit, and missing snapshot schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/lib/tenancy/table-ownership.ts`
- Generate: `drizzle/0115_*.sql`
- Generate: `drizzle/meta/0115_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/kiotviet-data-sync-migration.test.mjs`

- [ ] Write a failing PGlite migration test for `kiotviet_sync_runs`, `kiotviet_source_mappings`, tenant-scoped uniqueness, same-store validation support, `suppliers.is_active`, return settlement fields, and purchase-line unit snapshots.
- [ ] Add the Drizzle schema and generate the migration.
- [ ] Add RLS, revoke `anon`/`authenticated`, and keep the two operational tables server-only.
- [ ] Verify migration compatibility for existing rows and the complete migration chain.
- [ ] Run the focused migration test and require green.

### Task 2: Build shared parsers, source hashing, and deterministic planning

**Files:**
- Create: `src/lib/kiotviet/data-sync-types.ts`
- Create: `src/lib/kiotviet/data-sync-files.ts`
- Create: `src/lib/kiotviet/data-sync-plan.ts`
- Test: `tests/kiotviet-data-sync.test.ts`

- [ ] Write failing tests for exact workbook discovery, header validation, SHA-256 calculation, date/number normalization, duplicate code detection, document grouping, and stable child source keys.
- [ ] Parse all seven workbook types without a database dependency.
- [ ] Reject ambiguous duplicates and header/line/payment reconciliation errors before planning writes.
- [ ] Produce deterministic create/adopt/update/preserve/conflict actions and summaries.
- [ ] Verify the supplied files produce 103 customers, 59 suppliers, 23 bookings, 2,839 sales, 1,169 purchases, 113 customer returns, and 65 supplier returns.

### Task 3: Implement the store-scoped database adapter and invariant harness

**Files:**
- Create: `src/lib/kiotviet/data-sync-database.ts`
- Create: `src/lib/kiotviet/data-sync-runner.ts`
- Test: `tests/kiotviet-data-sync-database.test.mjs`

- [ ] Define a small transaction repository interface and a recording fake.
- [ ] Test mapping-first lookup, safe legacy adoption, collision blocking, child-ID preservation, run audit writes, and rollback behavior.
- [ ] Snapshot stock levels, stock reservations, stock lots/movements, customer/supplier balances, cashbook counts/totals, receivable/payable entries, and notification/outbox counts.
- [ ] Enforce unchanged history-phase invariants before commit.
- [ ] Reject `--apply` without `--store=hai-dang` and the exact reviewed source hash.

### Task 4: Synchronize customer master data

**Files:**
- Create: `src/lib/kiotviet/customer-sync.ts`
- Test: `tests/kiotviet-customer-sync.test.ts`

- [ ] Test managed-field updates, signed debt, total-spent snapshot, inactive handling, Luma-only preservation, and preservation of consent/Zalo/portal/type/debt-limit fields.
- [ ] Plan adoption of 95 matched customers, creation of 8 missing customers, 11 debt corrections, and 18 total-spent corrections.
- [ ] Add inactive historical customer placeholders only for non-empty document customer codes absent from the master file.
- [ ] Verify the source debt total is `130,924,782` and source net sales total is `3,400,176,291` before apply.

**Production checkpoint A:** review customer dry-run, back up affected rows, apply one transaction, and verify exact snapshot totals.

### Task 5: Synchronize supplier master data

**Files:**
- Create: `src/lib/kiotviet/supplier-sync.ts`
- Test: `tests/kiotviet-supplier-sync.test.ts`

- [ ] Test managed-field updates, signed debt, active state, Luma-only preservation, and the tenant-scoped unknown-supplier placeholder.
- [ ] Plan adoption of 58 matched suppliers, creation of 1 missing supplier, and 11 debt corrections.
- [ ] Verify the source debt total is `69,447,521` and source net purchases total is `4,032,549,434` before apply.

**Production checkpoint B:** review supplier dry-run, apply one transaction, and verify exact snapshot totals.

### Task 6: Resolve all historical products and alternate units

**Files:**
- Create: `src/lib/kiotviet/history-product-resolver.ts`
- Test: `tests/kiotviet-history-product-resolver.test.ts`

- [ ] Test base SKU, alternate-unit SKU, archived source mapping, and historical-placeholder resolution.
- [ ] Prove alternate-unit quantities retain their source unit and multiplier and never resolve to archived legacy unit-placeholder products.
- [ ] Audit all 2,616 unique history SKUs and the 1,075 lines using 277 alternate-unit SKUs.
- [ ] Block every document apply until all product references are resolved or explicitly approved as inactive historical placeholders.

**Production checkpoint C:** review and create only the truly missing inactive historical product placeholders; verify stock is unchanged.

### Task 7: Synchronize bookings (`DatHang`)

**Files:**
- Create: `src/lib/kiotviet/booking-sync.ts`
- Test: `tests/kiotviet-booking-sync.test.ts`

- [ ] Test `document_type=booking`, status mapping, totals, source units, delivery date, customer/payment snapshot, and stable line/payment keys.
- [ ] Test that 22 completed bookings cannot be converted again and 1 temporary booking remains draft.
- [ ] Import 23 documents / 361 lines without stock reservations, stock movements, debt changes, cashbook rows, or notifications.
- [ ] Update booking list filters/status presentation if needed so historical completed/draft bookings remain inspectable.

**Production checkpoint D:** review 23-document dry-run, apply, then rerun dry-run to zero changes.

### Task 8: Reconcile sales invoices (`HoaDon`)

**Files:**
- Create: `src/lib/kiotviet/sales-sync.ts`
- Test: `tests/kiotviet-sales-sync.test.ts`

- [ ] Test source header/line/payment reconciliation, anonymous customer handling, zero-price lines, mixed payment channels, booking linkage, and child-ID preservation.
- [ ] Adopt/reconcile 2,640 existing invoices and create 199 missing invoices for a source total of 2,839 invoices / 9,305 lines.
- [ ] Resolve 374 historical missing-master line occurrences through source mappings, alternate units, or approved inactive placeholders.
- [ ] Preserve Luma-native orders and payments and block same-code collisions.
- [ ] Verify revenue reports count only sale documents and do not double-count booking snapshots.
- [ ] Prove no stock, debt, cashbook, e-invoice, shift, or notification side effects.

**Production checkpoint E:** review sales dry-run and exceptions, apply one transaction, verify source totals, then rerun dry-run to zero changes.

### Task 9: Reconcile purchase receipts (`NhapHang`)

**Files:**
- Create: `src/lib/kiotviet/purchase-sync.ts`
- Test: `tests/kiotviet-purchase-sync.test.ts`

- [ ] Test status, subtotal, receipt discount, VAT/tax, total, amount paid, invoice number, supplier, alternate units, and line costs.
- [ ] Adopt/reconcile 1,091 existing receipts and create 78 missing receipts for 1,169 receipts / 4,611 lines.
- [ ] Explicitly repair the 1,089 existing source receipts with incorrect zero subtotal.
- [ ] Preserve Luma-native purchases and block same-code collisions.
- [ ] Prove no stock receipt, lot/movement, supplier debt, cashbook, or notification side effects.

**Production checkpoint F:** review purchase dry-run, apply one transaction, verify source totals, then rerun dry-run to zero changes.

### Task 10: Reconcile customer returns (`TraHang`)

**Files:**
- Create: `src/lib/kiotviet/return-sync.ts`
- Test: `tests/kiotviet-return-sync.test.ts`

- [ ] Test exact invoice/item linking, missing-invoice fallback, return settlement snapshot, partial returns, cumulative full-return detection, and existing child-ID preservation.
- [ ] Adopt/reconcile 104 existing returns and create 9 missing returns for 113 returns / 440 lines.
- [ ] Preserve 38 missing-invoice cases as inspectable historical exceptions rather than inventing invoice relationships.
- [ ] Keep 70 partial returns partial and repair the 63 known incorrectly returned parent statuses.
- [ ] Prove no restock, lot/movement, refund, debt/total-spent, cashbook, or notification side effects.

**Production checkpoint G:** review return linkage exceptions, apply one transaction, recompute parent statuses, then rerun dry-run to zero changes.

### Task 11: Reconcile supplier returns (`TraHangNhap`)

**Files:**
- Create: `src/lib/kiotviet/purchase-return-sync.ts`
- Test: `tests/kiotviet-purchase-return-sync.test.ts`

- [ ] Test return totals, unit snapshots, discounts, tax, paid amount, debt amount, and correct unsettled/partial/settled classification.
- [ ] Adopt/reconcile 62 existing returns and create 3 missing returns for 65 returns / 198 lines.
- [ ] Repair the 52 known incorrect settlement statuses.
- [ ] Leave purchase links null when the source provides no exact receipt identity.
- [ ] Prove no stock consumption, lot/movement, supplier debt, cashbook, or notification side effects.

**Production checkpoint H:** review supplier-return dry-run, apply one transaction, verify settlement totals, then rerun dry-run to zero changes.

### Task 12: Add the CLI, disable unsafe legacy writes, and complete verification

**Files:**
- Create: `src/scripts/sync-kiotviet-data.ts`
- Modify: `src/scripts/import-kiotviet-history.ts`
- Modify: `src/scripts/import-kiotviet.ts`
- Modify: `package.json`
- Test: `tests/kiotviet-data-sync-cli.test.ts`

- [ ] Add `bun sync:kiotviet-data <directory> --store=hai-dang --phase=<phase>` with dry-run default and guarded apply.
- [ ] Add deterministic summaries, workbook hashes, conflict reports, invariant reports, and post-apply zero-diff checks.
- [ ] Fail closed on legacy history writes and direct operators to the new phase-based CLI.
- [ ] Keep legacy source inspection read-only where useful.
- [ ] Run all focused synchronization tests, the migration suite, `bunx tsc --noEmit`, lint for affected files, and the full repository test suite.
- [ ] Run `--phase=all` dry-run against the supplied bundle and require zero header/line/payment reconciliation errors before any production apply.
- [ ] After checkpoint H, run a complete final audit proving source counts/totals, Luma-only preservation, exact customer/supplier snapshots, unchanged operational ledgers, and zero changes on a second dry-run.

## Recommended production order

1. Schema/provenance migration.
2. Customers.
3. Suppliers.
4. Historical product/unit resolution.
5. Bookings.
6. Sales invoices.
7. Purchase receipts.
8. Customer returns.
9. Supplier returns.
10. Cross-domain final audit.

This order creates every required parent identity before dependent documents and leaves returns until their source sales/purchases have been reconciled.

## Verification commands

Run focused checks while implementing each slice, then the integrated checks before the first production checkpoint:

```text
bun test tests/kiotviet-data-sync.test.ts
bun test tests/kiotviet-data-sync-migration.test.mjs
bun test tests/kiotviet-data-sync-database.test.mjs
bun test tests/kiotviet-customer-sync.test.ts tests/kiotviet-supplier-sync.test.ts
bun test tests/kiotviet-history-product-resolver.test.ts
bun test tests/kiotviet-booking-sync.test.ts tests/kiotviet-sales-sync.test.ts
bun test tests/kiotviet-purchase-sync.test.ts
bun test tests/kiotviet-return-sync.test.ts tests/kiotviet-purchase-return-sync.test.ts
bun test tests/kiotviet-data-sync-cli.test.ts
bunx tsc --noEmit
bun test
bun sync:kiotviet-data /Users/cvthien/Downloads --store=hai-dang --phase=all
```

Expected integrated dry-run result: all seven files are found by exact supported filename pattern, all source header/line/payment totals reconcile, every action is deterministic, no database writes occur, and the report prints one SHA-256 per source file plus the aggregate bundle hash.
