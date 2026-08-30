# Task 7 — KiotViet bookings (`DatHang`)

## Outcome

Implemented a deterministic, side-effect-free booking planner in
`src/lib/kiotviet/booking-sync.ts` and a focused test suite in
`tests/kiotviet-booking-sync.test.ts`.

The planner consumes explicit resolved customer and product snapshots; it does
not read the database or call any operational order, stock, debt, cashbook, or
notification code. Missing non-anonymous customer references and missing product
resolutions are returned as blocking exceptions and suppress every write payload.

Each successful document payload contains only direct ledger snapshots:

- `orders.document_type = booking`;
- `Hoàn thành -> completed`, which the existing conversion guard does not accept
  (`orders/convert.ts` permits only `quote` and `confirmed`); and
  `Phiếu tạm -> draft`;
- source header totals, paid amount, delivery date, creation time, note, customer
  identity, source-unit line snapshots, and non-zero payment-channel snapshots;
- deterministic source keys for duplicate line occurrences and payment channels.

The booking list now defaults to `all` and exposes `Hoàn thành` and `Phiếu tạm`
as explicit custom-picker options, so historical bookings remain inspectable.

No production data was read or written beyond the supplied workbook files, and
no apply command was run.

## TDD evidence

### RED

1. Added the planner contract test, then ran:

   ```text
   bun test tests/kiotviet-booking-sync.test.ts
   ```

   It failed as expected because `@/lib/kiotviet/booking-sync` did not exist.

2. Added the booking-status filter contract test, then reran the same command.
   It failed as expected because `@/lib/orders/booking-status-filter` did not
   exist.

### GREEN

After the minimal planner and UI filter implementation:

```text
bun test tests/kiotviet-booking-sync.test.ts
```

Result: 4 passed, 0 failed, 22 assertions.

The focused test independently verifies:

- exact header/line/payment projections for a hand-checked fixture;
- `documentType`, completed/draft lifecycle states, payment status, customer,
  delivery timestamp, source quantities/units/multipliers, and stable child keys;
- blocking unresolved customer/product references with no write payload;
- the supplied 23-document / 361-line booking workbook: 22 completed and one
  draft booking, all as `documentType: booking`, and no operational-action fields;
- default and selectable completed/draft booking filters.

## Relevant verification

```text
bunx eslint src/lib/kiotviet/booking-sync.ts src/lib/orders/booking-status-filter.ts src/app/(app)/sales/tabs/bookings.tsx src/app/(app)/sales/tabs/document-filter-drawer.tsx tests/kiotviet-booking-sync.test.ts
```

Result: exit 0.

```text
bun test tests/kiotviet-data-sync.test.ts tests/kiotviet-data-sync-database.test.mjs tests/kiotviet-customer-sync.test.ts tests/kiotviet-supplier-sync.test.ts tests/kiotviet-history-product-resolver.test.ts tests/kiotviet-booking-sync.test.ts
```

Result: 38 passed, 2 intentionally skipped workbook-dependent predecessor tests,
0 failed.

```text
bunx tsc --noEmit
```

Result: failed on existing unrelated product/media worktree changes, existing
customer-sync typing, and the repository's test-type configuration (including
missing `bun:test`/`vitest` declarations). The output contained no errors in the
Task 7 planner, status filter, or touched booking UI files.

`git diff --check` also passed.

## Self-review

Specification: pass for the pure-planner scope. The supplied workbook check
proves the expected 23 documents / 361 lines and 22 completed / 1 draft mapping.
All booking writes are suppressed if a resolved source identity is missing; no
planner output models stock, operational reservations, cashbook, debt, or
notification work.

Engineering quality: pass. The planner follows the shared grouping,
reconciliation, normalization, fingerprint, entity-plan, and stable-child-key
helpers. Its only dependencies are source rows and explicit resolution/current
snapshots, so it is deterministic and store-agnostic.

## Remaining integration work / concerns

- This task deliberately does not apply data. Production checkpoint D remains
  for Task 12's store-scoped adapter/CLI orchestration: review dry-run, approved
  apply, then zero-diff dry-run.
- No reviewed booking row has a non-zero `Ví` or `Điểm` channel. Their channel
  names and stable keys are preserved by the planner; the eventual adapter must
  retain the documented method mapping when such a row is encountered.
- Repository-wide `tsc` is currently not a usable green gate because of the
  unrelated failures listed above.
