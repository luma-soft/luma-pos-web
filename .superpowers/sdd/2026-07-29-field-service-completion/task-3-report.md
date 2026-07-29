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

## Reviewer fix round 1

All six reviewer findings and the follow-up payload-fingerprint finding were
addressed without editing applied migration `0071`.

### Additional RED evidence

- The expanded all-status test failed because `waiting_materials` check-in was
  accepted instead of raising `SERVICE_VISIT_STATUS_INVALID`.
- Reusing the same mutation/job/operation tuple with a different latitude
  returned the original result instead of raising
  `SERVICE_MUTATION_PAYLOAD_CONFLICT`.
- The first independent-session PostgreSQL run found a real `40P01` deadlock:
  competing receipt inserts held foreign-key locks before both transactions
  tried to lock the same job row.

### Fixes

- Check-in is explicitly limited to `new`, `scheduled`, `in_progress`, and
  `warranty`; waiting and terminal states create neither visit nor time entry.
- Migration `0072_service_visit_concurrency_guards.sql` replaces the checklist
  guard using both `OLD.status` and `NEW.status`, rejects completion with open
  work, guards direct visit/time-entry insertion/reopening/reassignment, and
  adds `installed_assets.created_by` to terminal business fields.
- Completed business changes retain
  `SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED`; cancelled changes return
  `SERVICE_FIELD_JOB_TERMINAL`.
- Closing an existing visit/time entry remains possible after cancellation.
- Core mutations now lock the job before inserting their idempotency receipt,
  eliminating the PostgreSQL FK/job-lock deadlock. Signature creation retains
  the Task 1 attachment-then-job order.
- Migration `0073_service_field_mutation_input_hash.sql` adds a constrained
  SHA-256 input fingerprint. New receipts reject same-key/different-payload
  replay. Legacy receipts with a null fingerprint remain replay-compatible
  because their original payload cannot be reconstructed.

### Independent-session PostgreSQL evidence

Command:

```text
bun --env-file=.env.local test \
  tests/service-visit-concurrency-postgres.test.mjs
```

The harness uses two checked-out `pg` sessions, UUID-namespaced fixtures, and
`finally` cleanup. It verified:

- simultaneous check-ins produce one active visit and one open work entry;
- when check-in holds the job lock first, completion waits then rejects open
  work;
- when completion holds the job lock first, check-in waits then rejects the
  completed status;
- simultaneous open time-entry inserts produce one row and one partial-index
  rejection.

The final run completed without warnings. A direct cleanup audit found zero
`visit-race-*` projects and profiles.

### Migration and final verification

- Applied `0072` (9 statements) and `0073` (2 statements).
- A subsequent migration run reported zero pending.
- Direct schema checks confirmed both new triggers, the replaced checklist and
  asset functions, `input_hash varchar(64)`, its check constraint, both
  migration records, and function ACLs limited to `postgres`/`service_role`.
- Focused PGlite/Task 1/Task 2 regression: `11 pass, 0 fail`.
- Independent PostgreSQL concurrency harness: completed successfully.
- Changed-file ESLint: exit code 0.
- `bun run build`: compiled, type-checked, and generated all 97 static pages
  successfully.

## Reviewer fix round 2

The second review found two remaining concurrency hazards: field authorization
could become stale while an assignment was being revoked, and visit/time-entry
updates could form a child-to-job lock cycle with job completion.

### RED evidence

- A direct visit reassignment was accepted instead of raising
  `SERVICE_VISIT_IDENTITY_IMMUTABLE`.
- In the independent-session PostgreSQL harness, a primary-assignment writer
  held the job lock and committed reassignment, but the original technician's
  waiting mutation still succeeded because authorization was not re-read after
  the lock.

### Fixes

- Added and applied immutable migration
  `0074_service_assignment_and_closure_locks.sql`.
- Primary and crew-assignment changes now serialize through the canonical
  service-job row. Field mutations lock that row first and then re-read current
  assignment membership before authorizing the actor.
- Evidence deletion preserves its attachment-then-job order and now performs
  crew authorization only after acquiring the job lock.
- Evidence upload revalidates assignment inside the attachment insert
  transaction.
- Assignment removal, primary-assignee cleanup, and audit-event creation now
  commit atomically.
- Visit identity and time-entry identity are immutable. Closed visits and time
  entries cannot be reopened.
- Visit checkout and time-entry closure are intentionally child-only updates:
  they do not acquire the parent job lock. Only the permitted active-to-terminal
  closure shape is accepted, removing the inverse child-to-job edge while
  retaining terminal and identity guards.
- The API maps the new immutable/reopen guard errors to HTTP 409 invalid
  transition responses.

### Independent-session PostgreSQL evidence

The PostgreSQL harness now also verifies:

- primary reassignment obtains the job lock first, the original technician's
  mutation waits, then rejects with `SERVICE_JOB_FORBIDDEN`;
- crew removal obtains the job lock first, the removed technician's mutation
  waits, then rejects;
- while completion holds the job lock, visit checkout and time-entry closure
  can finish without waiting for that parent lock, after which completion
  succeeds without a deadlock.

The harness completed successfully and its cleanup audit found zero namespaced
fixture projects or profiles.

### Migration and final verification

- Applied `0074` (8 statements); a subsequent migration run reported zero
  pending.
- Direct schema checks confirmed the assignment, primary-assignment, visit, and
  time-entry triggers and function ACLs limited to
  `postgres`/`service_role`.
- Focused state-machine, field-operation, signed-snapshot,
  evidence-deletion, schema, and access regression:
  `17 pass, 0 fail, 44 expect() calls`.
- Independent PostgreSQL concurrency harness: completed successfully.
- Changed-file ESLint: exit code 0.
- `bun run build`: compiled, type-checked, and generated all 97 static pages
  successfully.
