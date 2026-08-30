# KiotViet Product Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, idempotent, dry-run-first product synchronizer that treats the KiotViet snapshot as authoritative for KiotViet-managed products while preserving LumaPOS-native products and historical references.

**Architecture:** A pure product parser and planner owns source semantics and classification. A CLI adapter reads Excel and current database state, prints the plan by default, and applies it transactionally only with explicit flags. A source-mapping table records provenance, while nullable unit SKUs prevent alternate units from becoming products.

**Tech Stack:** Bun, TypeScript, SheetJS, Drizzle ORM, PostgreSQL/Supabase, Bun Test, PGlite.

**Spec:** `docs/superpowers/specs/2026-08-30-kiotviet-product-sync-design.md`

## Global Constraints

- Product synchronization only; customer, supplier, and history imports remain unchanged.
- Default behavior is dry-run; writes require `--apply --store=hai-dang`.
- No production schema migration or product mutation is part of implementation verification.
- Base-row stock is authoritative; alternate-unit stock is never additive.
- KiotViet deletions are archived, not physically deleted.
- LumaPOS-native products and custom price-book overrides remain untouched.
- All database reads and writes are scoped by `store_id`.

---

### Task 1: Pure KiotViet product parsing and planning

**Files:**
- Create: `src/lib/kiotviet/product-sync.ts`
- Test: `tests/kiotviet-product-sync.test.ts`

**Interfaces:**
- Consumes: normalized Excel rows and current Luma product/source-mapping snapshots.
- Produces: `parseKiotVietProductRows(rows)`, `planKiotVietProductSync(input)`, and the exported snapshot/plan types used by the CLI adapter.

- [ ] **Step 1: Write failing parser tests**

Cover a base product plus alternate unit and assert the hand-derived base stock, unit SKU, multiplier, unit price, product kind, status, image URLs, VAT, and combo components. Assert that alternate stock does not change base stock.

- [ ] **Step 2: Run the focused test and verify RED**

Run `bun test tests/kiotviet-product-sync.test.ts`. Expected: failure because `src/lib/kiotviet/product-sync.ts` and its exports do not exist.

- [ ] **Step 3: Implement the parser minimally**

Create explicit `KiotVietProduct`, `KiotVietUnit`, and `KiotVietComboComponent` types. Normalize text and numbers, parse attributes into `specs`, map product kinds, split image URLs, parse VAT, and preserve `directSale` for reporting without mapping it to `isActive`.

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run `bun test tests/kiotviet-product-sync.test.ts`. Expected: parser cases pass.

- [ ] **Step 5: Write failing planner tests**

Use literal snapshots to prove: matched base SKUs update, missing base SKUs create, mapped-but-missing products archive, historical non-unit products archive on first adoption, alternate-unit placeholders archive, and Luma-only products remain preserved.

- [ ] **Step 6: Run the planner tests and verify RED**

Run `bun test tests/kiotviet-product-sync.test.ts`. Expected: planner export or expected classifications are missing.

- [ ] **Step 7: Implement and refactor the planner**

Return deterministic sorted action arrays and summary counts. Reject duplicate base SKUs, duplicate unit SKUs, orphan units, and unresolved combo components. Keep the planner free of database and filesystem dependencies.

- [ ] **Step 8: Run the focused tests and verify GREEN**

Run `bun test tests/kiotviet-product-sync.test.ts`. Expected: all parser and planner tests pass.

### Task 2: Provenance and unit-SKU database contract

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/lib/tenancy/table-ownership.ts`
- Generate: `drizzle/0114_*.sql`
- Generate: `drizzle/meta/0114_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/kiotviet-product-sync-migration.test.mjs`

**Interfaces:**
- Consumes: `products`, `product_units`, `stores`, and `current_active_store_id()`.
- Produces: `productSourceMappings` Drizzle table and nullable `productUnits.sku`.

- [ ] **Step 1: Write a failing PGlite migration test**

Assert that all migrations yield `product_source_mappings`, a nullable `product_units.sku`, tenant-scoped unique source identities, tenant-scoped unit SKU uniqueness, a same-store product foreign key, and enabled RLS.

- [ ] **Step 2: Run the migration test and verify RED**

Run `bun test tests/kiotviet-product-sync-migration.test.mjs`. Expected: missing table and column assertions fail.

- [ ] **Step 3: Add the schema contract**

Define `productSourceMappings` with `storeId`, `productId`, `provider`, `externalId`, `lastSeenAt`, `deletedAt`, `createdAt`, and `updatedAt`. Add composite tenant foreign keys and unique indexes. Add nullable `sku` to `productUnits` with a partial unique `(store_id, sku)` index.

- [ ] **Step 4: Generate the Drizzle migration**

Run `bun db:generate`. Review the generated SQL, then add `ENABLE ROW LEVEL SECURITY`, revoke all `anon`/`authenticated` privileges, and keep the operational mapping table free of Data API policies.

- [ ] **Step 5: Run the migration test and verify GREEN**

Run `bun test tests/kiotviet-product-sync-migration.test.mjs`. Expected: schema, uniqueness, tenant isolation, and RLS assertions pass.

### Task 3: Dry-run-first database adapter and CLI

**Files:**
- Create: `src/scripts/sync-kiotviet-products.ts`
- Modify: `package.json`
- Test: `tests/kiotviet-product-sync-cli.test.ts`

**Interfaces:**
- Consumes: the pure parser/planner, SheetJS workbook rows, and store-scoped Drizzle snapshots.
- Produces: `bun sync:kiotviet-products <directory> --store=hai-dang` with optional `--apply`.

- [ ] **Step 1: Write failing CLI contract tests**

Exercise exported argument parsing and summary formatting. Assert dry-run default, rejection of `--apply` without an exact store, deterministic counts, and a warning when source mappings are unavailable before migration.

- [ ] **Step 2: Run the CLI test and verify RED**

Run `bun test tests/kiotviet-product-sync-cli.test.ts`. Expected: missing CLI contract exports.

- [ ] **Step 3: Implement read and planning seams**

Read the newest product export plus available history workbooks, load store-scoped products and mappings, call the pure planner, and print create/update/archive/preserve/unit/stock summaries. Keep imports of the database lazy so source-only validation remains testable.

- [ ] **Step 4: Run the CLI test and verify GREEN**

Run `bun test tests/kiotviet-product-sync-cli.test.ts`. Expected: dry-run and flag-validation cases pass.

- [ ] **Step 5: Write failing apply-adapter tests at the stable transaction seam**

Use a recording repository fake with complete product, stock, unit, combo, mapping, category, and brand operations. Assert one transaction boundary, source-field upserts, exact base stock, delta movements, unit replacement, mapping upserts, archive updates, and no operation for preserved Luma products.

- [ ] **Step 6: Run the apply-adapter test and verify RED**

Run `bun test tests/kiotviet-product-sync-cli.test.ts`. Expected: apply adapter is absent.

- [ ] **Step 7: Implement transactional application**

Apply the plan through a small repository interface backed by Drizzle. Resolve categories and brands within the target store, upsert every current source product, replace managed units, rebuild valid combos after product upserts, set default-warehouse stock, insert `init`/`adjust` deltas, upsert/clear mappings, and archive deleted or erroneous placeholder products.

- [ ] **Step 8: Run the focused CLI tests and verify GREEN**

Run `bun test tests/kiotviet-product-sync-cli.test.ts`. Expected: all CLI and transaction-seam behavior passes.

### Task 4: Disable the unsafe legacy product write path

**Files:**
- Modify: `src/scripts/import-kiotviet.ts`
- Test: `tests/kiotviet-product-sync-cli.test.ts`

**Interfaces:**
- Consumes: legacy `bun import:kiotviet` invocations.
- Produces: a fail-closed message directing product writes to the new synchronizer while retaining legacy dry-run/customer/supplier inspection behavior.

- [ ] **Step 1: Write a failing legacy-safety test**

Assert that a non-dry-run legacy product import cannot reach the previous additive stock/create-only path and reports the exact safe replacement command.

- [ ] **Step 2: Run the focused test and verify RED**

Run `bun test tests/kiotviet-product-sync-cli.test.ts`. Expected: the legacy guard is absent.

- [ ] **Step 3: Add the fail-closed guard and remove unreachable unsafe product writes**

Keep `--dry-run` parsing available for historical inspection, but stop non-dry-run execution before database mutation with guidance to use `sync:kiotviet-products` and the separate customer/supplier workflow.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run `bun test tests/kiotviet-product-sync-cli.test.ts tests/kiotviet-product-sync.test.ts`. Expected: all focused behavior passes.

### Task 5: Integrated verification and real dry-run

**Files:**
- Modify only if verification exposes a scoped defect in files listed above.

**Interfaces:**
- Consumes: the completed synchronizer and supplied KiotViet workbook bundle.
- Produces: fresh evidence for implementation readiness without production writes.

- [ ] **Step 1: Run focused tests**

Run `bun test tests/kiotviet-product-sync.test.ts tests/kiotviet-product-sync-cli.test.ts tests/kiotviet-product-sync-migration.test.mjs` and require zero failures.

- [ ] **Step 2: Run static checks**

Run `bunx tsc --noEmit` and `bun lint` for the affected files or the repository-supported lint command. Classify unrelated pre-existing failures separately.

- [ ] **Step 3: Run the complete test suite**

Run `bun test` and require zero relevant regressions.

- [ ] **Step 4: Run the new real dry-run**

Run `bun sync:kiotviet-products /private/tmp/lumapos-product-review --store=hai-dang`. Confirm it does not mutate the database and reports 2,538 base products, 425 alternate units, 55 creates, 263 unit-placeholder archives, 211 historical/deleted candidates, and preserved Luma-only products subject to the live snapshot at execution time.

- [ ] **Step 5: Inspect the final diff and operation boundary**

Confirm no production migration was applied, no product data was written, no custom price-book override path was changed, and no customer/supplier/history importer behavior changed beyond the explicit legacy safety guard.
