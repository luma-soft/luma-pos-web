# Task 1 — Protect attachments and signatures

## Scope

Implemented the evidence-deletion safeguard for mobile field-service jobs.

## RED evidence

Before the implementation existed, ran:

```sh
bun test tests/service-evidence-deletion.test.mjs
```

Result: failed with `Cannot find module .../src/lib/services/evidence-deletion.ts` (0 pass, 1 fail). The new test suite specified the required deletion core and covered normal deletion, signed evidence, foreign creator, manager authority, Storage failure, database failure, and terminal-job locking.

## GREEN evidence

After implementation, ran:

```sh
bun test tests/service-evidence-deletion.test.mjs tests/service-evidence.test.ts tests/service-field-operations.test.mjs
bunx eslint src/lib/services/evidence-deletion.ts src/lib/services/field-api.ts 'src/app/api/mobile/services/jobs/[id]/attachments/route.ts' tests/service-evidence-deletion.test.mjs
git diff --check
```

Results: 11 tests passed, 0 failed; changed-file ESLint passed with no warnings or errors; `git diff --check` passed.

## Files

- `src/lib/services/evidence-deletion.ts` — transaction-aware deletion core with injected Storage collaborator.
- `src/app/api/mobile/services/jobs/[id]/attachments/route.ts` — authenticated DELETE route wired to the core.
- `src/lib/services/field-api.ts` — business-error to HTTP response mapping.
- `tests/service-evidence-deletion.test.mjs` — PGlite integration coverage for success and failure paths.

## Behavior

- Signed attachments are rejected with a business conflict before Storage is called.
- Only the creator, owner, or manager may delete unsigned evidence.
- Completed and cancelled jobs are locked; no owner exception was implemented.
- Storage failure leaves attachment metadata and no deletion event.
- Metadata deletion and the success event occur in one database transaction; if that database work fails after Storage removal, metadata is rolled back and remains available for recovery.
- A successful delete writes `job.attachment_deleted`.

## Commit

`feat(field-service): protect evidence deletion` (the final SHA is included in the task handoff because this report is part of the same commit).

## Concerns

No schema migration was added or applied; migration `0064` was not changed. The Storage provider has no distributed transaction with PostgreSQL, so a database failure after successful object removal intentionally retains recoverable metadata rather than deleting it silently. Restoring the object, if required, remains an operational recovery action.

---

## Review fix — durable tombstones

### RED evidence

Updated `tests/service-evidence-deletion.test.mjs` before changing the implementation, then ran:

```sh
bun test tests/service-evidence-deletion.test.mjs
```

Result: 0 passed, 9 failed. The old core required Storage as an in-transaction parameter, so the new tombstone API tests failed with `input.attachmentId` undefined. This demonstrated the old Storage-before-commit contract could not satisfy the durable-deletion requirements.

### Implementation

- Added `0065_service_attachment_tombstones.sql` without changing applied migration `0064`.
- Added durable deletion state (`deleted_at`, actor, cleanup timestamp, attempt count, and error) plus an active-evidence index.
- Added a database trigger that rejects direct signature inserts/updates referencing tombstoned attachments.
- Tombstone and `job.attachment_deleted` event now commit in one transaction before any Storage call.
- Storage cleanup now runs after commit, records failures, and is retryable/idempotent while preserving the tombstone.
- Restored active-assignment authorization for technicians; owner/manager access remains available.
- Excluded tombstones from field-job attachment reads, attachment signed-URL retrieval, completion evidence checks, and signature creation.
- Added the English and Vietnamese `services.errors.attachmentSigned` translation.

### GREEN evidence

```sh
bun test tests/service-evidence-deletion.test.mjs tests/service-evidence.test.ts tests/service-field-operations.test.mjs tests/service-field-schema.test.mjs
bunx eslint src/db/schema.ts src/lib/services/evidence-deletion.ts src/lib/services/field-operations.ts src/lib/services/field-api.ts src/lib/data/service-field.ts 'src/app/api/mobile/services/jobs/[id]/attachments/route.ts' 'src/app/api/mobile/services/jobs/[id]/attachments/[attachmentId]/route.ts' tests/service-evidence-deletion.test.mjs
git diff --check
```

Results: 14 tests passed, 0 failed; changed-file ESLint and diff hygiene passed.

Migration application and verification:

```sh
bun run src/db/apply-migrations.ts
```

Result: applied `0065_service_attachment_tombstones.sql` (4 statements). A database query then confirmed all five tombstone columns and the `_migrations` record; a second migration run reported no pending migrations.

### Review-fix concerns

Storage cleanup is deliberately post-commit. If its acknowledgement update fails after the provider removed the object, the persisted tombstone remains permanently unsigned and a later cleanup retry is safe. An operational worker is still needed to proactively drain failed cleanup attempts rather than relying only on a later DELETE retry.
