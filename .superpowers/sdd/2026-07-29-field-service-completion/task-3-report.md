# Task 3 report: visit and field mutation state machines

## Outcome

- Check-in now accepts non-terminal jobs only and rejects completed/cancelled
  jobs.
- Active visits are unique per `(job_id, profile_id)` at the database layer,
  including concurrent inserts, while the same technician may have active
  visits on different jobs.
- Checkout locks and closes the active visit plus only its matching open work
  time entry.
- A checked-out in-progress job can start a later visit.
- Completion locks the job and rejects any active visit or open time entry
  before evidence/signature validation.
- Checklist, material, installed-asset, and evidence business mutations are
  rejected after completion/cancellation at both the field-service core and
  database boundaries. Attachment Storage cleanup/lease bookkeeping remains
  allowed.
- `clientMutationId` replay returns the original result, while reuse for a
  different operation/job is rejected.

## RED

Command:

```text
bun test tests/service-visit-state-machine.test.mjs
```

Observed expected failure before production changes:

```text
AssertionError: Missing expected rejection: expected SERVICE_VISIT_STATUS_INVALID
```

An additional replay-contract RED was observed before the idempotency receipt
validation:

```text
AssertionError: Missing expected rejection: expected SERVICE_MUTATION_ID_CONFLICT
```

## GREEN and regression verification

```text
bun test tests/service-visit-state-machine.test.mjs \
  tests/service-field-operations.test.mjs \
  tests/service-signed-snapshot.test.mjs \
  tests/service-evidence-deletion.test.mjs \
  tests/service-field-schema.test.mjs
```

Result: `11 pass, 0 fail, 32 expect() calls`.

Changed-file ESLint completed with exit code 0:

```text
bunx eslint src/lib/services/field-operations.ts \
  src/lib/services/field-api.ts src/db/schema.ts \
  src/app/api/mobile/services/jobs/[id]/attachments/route.ts \
  tests/service-visit-state-machine.test.mjs \
  tests/service-field-schema.test.mjs \
  tests/service-evidence-deletion.test.mjs
```

`bunx tsc --noEmit` remains globally red on pre-existing test-environment
issues (primarily missing `bun:test`/`vitest` type declarations and unrelated
test fixture type errors); it did not report an error in a Task 3 source file.

## Migration verification

- Added and applied immutable migration
  `0071_service_visit_state_machine.sql`.
- Pre-apply checks found no duplicate active `(job_id, profile_id)` visits and
  no duplicate open time entries for a visit.
- First runner applied 14 statements.
- Second runner reported zero pending migrations.
- Direct production schema queries confirmed:
  - `service_visits_job_profile_active_idx`
  - `service_time_entries_visit_open_idx`
  - `service_jobs_guard_terminal_checklist`
  - `installed_assets_guard_terminal_job`
  - `service_job_materials_guard_terminal_job`
  - `service_attachments_guard_terminal_job`
  - `_migrations.name = '0071_service_visit_state_machine.sql'`

## Compatibility and concerns

- Completed-job asset/evidence snapshot changes retain Task 2's
  `SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED` policy. Cancelled jobs use
  `SERVICE_FIELD_JOB_TERMINAL`.
- Attachment cleanup-only columns are excluded from terminal business guards,
  preserving Task 1 retry/lease behavior.
- The database unique indexes are the concurrency authority. The PGlite
  regression exercises the actual constraints and application transaction
  paths, but does not create two simultaneous server connections.
