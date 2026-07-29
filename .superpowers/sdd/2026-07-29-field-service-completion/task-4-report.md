# Task 4 report — maintenance lifecycle

## Outcome

- Added explicit concrete `service_type` ownership to every maintenance plan.
  Mixed projects require an explicit camera/electrical/plumbing choice and no
  longer default silently to camera.
- Kept the durable chain `plan -> occurrence -> generated job`, with unique
  `(plan_id, due_on)` and unique non-null `job_id` constraints.
- Completing a generated field job now completes its linked occurrence and,
  in the same transaction, advances `last_completed_on` and `next_due_on`.
  The next date is anchored to the completed occurrence's due date so
  consecutive cycles do not drift.
- Completion replay is a no-op after the occurrence is completed. Transaction
  rollback was verified across occurrence and plan state.
- The worker marks past scheduled occurrences overdue and emits a stable
  per-occurrence notification key. Targets are the exact set of active assigned
  technicians (primary and crew) plus active owners/managers. Existing push
  delivery uniqueness skips successful repeats while allowing failed attempts
  to retry.
- Removed the direct plan-completion UI path. The legacy endpoint now returns a
  business error directing managers to complete the generated job.

## TDD evidence

### RED

1. `bun tests/service-maintenance-worker.test.mjs`
   - Failed with `mixed maintenance plan silently defaulted to camera`.
2. The lifecycle assertion failed because completing a generated job did not
   update its occurrence or plan.
3. The overdue assertion failed because overdue transition, stable escalation
   key, and exact recipient calculation did not exist.

### GREEN

- `bun tests/service-maintenance-worker.test.mjs`
  - Passes generation replay, explicit trade selection for mixed projects,
    two consecutive cycles, completion replay, atomic rollback, overdue
    transition, stable escalation key, and exact recipient set.
- `bun test tests/service-field-operations.test.mjs tests/service-maintenance-worker.test.mjs tests/service-field-schema.test.mjs tests/service-schema.test.mjs`
  - Exit 0; all four PGlite scripts completed successfully.
- `bun test tests/service-domain.test.ts tests/mobile-final-table-surfaces.test.tsx`
  - 36 passed, 0 failed.
- Changed-file ESLint
  - Exit 0.
- `bun run build`
  - Exit 0; compilation, TypeScript, page generation, and route build passed.

## Migration verification

- Migration: `0075_service_maintenance_lifecycle.sql`.
- First apply intentionally stopped at the ACL assertion because the legacy
  plan table still granted app-role writes. Since the migration had not been
  tracked, guarded revokes were added and the migration was replayed safely.
- Apply then succeeded; immediate rerun reported zero pending migrations.
- Direct database checks confirmed:
  - `service_maintenance_plans.service_type` is `NOT NULL`.
  - Concrete-only service type check constraint is present.
  - Partial unique `service_maintenance_occurrences_job_idx` is present.
  - `anon` and `authenticated` have no `INSERT` privilege on plans or
    occurrences.
  - `_migrations` contains `0075_service_maintenance_lifecycle.sql`.

## Remaining concerns

- Overdue escalation currently uses the existing mobile push channel and its
  durable per-device delivery ledger. Adding other notification channels would
  require their own idempotent delivery ledger; none was added in this task.
- Existing deployments with an unclassified legacy plan under a mixed project
  would be stopped by migration with an explicit error instead of guessing a
  trade. The configured database had no maintenance plans requiring backfill.

## Review fix round 1

The initial scoped review found two Critical and three Important gaps. This
round addresses all five:

- Manager `transitionServiceJob` now locks the job and invokes the same
  transactional maintenance lifecycle used by mobile completion, including
  replay recovery for an already-completed job.
- Migration `0076_service_maintenance_review_fixes.sql` changes occurrence
  history to `ON DELETE RESTRICT`; the delete action returns a specific
  conflict for plans with history while unused plans remain deletable.
- Push delivery now atomically claims a device/key row with a token and lease
  before FCM. Only the claimant sends, token-matched acknowledgement publishes
  the result, terminal success cannot be overwritten, and failed/stale claims
  can retry.
- A preflight-backed partial unique index permits only one scheduled/overdue
  occurrence per plan. Generation locks the plan first, schedule edits reject
  conflicting outstanding work, completion uses plan-then-occurrence order,
  and completion dates are monotonic under out-of-order work.
- Web job reassignment now atomically keeps `service_jobs.assigned_to` and the
  active primary assignment row aligned. Plan/job assignees must be active
  technicians, form options are technician-only, and overdue recipients use
  only the canonical current technician, active crew, and active owners/
  managers.

### Review-fix RED/GREEN evidence

- RED: edited `next_due_on` generated a second outstanding occurrence.
- RED: web-style primary reassignment left job and assignment state divergent.
- RED: invalid manager-as-technician assignment returned a generic server
  error.
- GREEN:
  - `bun tests/service-maintenance-worker.test.mjs`
  - `bun tests/service-maintenance-manager-actions.test.mjs`
  - `bun tests/service-maintenance-concurrency-postgres.test.mjs`
  - `bun tests/push-delivery-concurrency-postgres.test.mjs`
- The independent-session tests prove one generated occurrence/job and one
  push send under concurrency. They also prove terminal push success is not
  regressed and failed delivery is retryable.
- `0076` applied successfully; the immediate rerun reported zero pending.
  Direct checks confirmed the RESTRICT FK, outstanding partial unique index,
  push claim columns/index, and no anon/authenticated INSERT privilege.
- Changed-file ESLint and `bun run build` pass.

## Review fix round 2

The remaining push-delivery lease issue is closed without a schema change:

- The send collaborator now receives an `AbortSignal`; production passes it
  directly to FCM `fetch`.
- Defaults bound FCM to four minutes inside a five-minute claim lease, leaving
  sixty seconds for abort propagation, settlement, and token-fenced
  acknowledgement. Configuration is rejected unless
  `sendTimeout + safetyMargin < leaseDuration`.
- Timeout aborts the request and waits for actual sender settlement before
  marking the matching claim failed. A sender that ignores abort remains
  fail-closed: the worker renews its token-matched lease and does not release
  the claim until that sender settles.
- The real PostgreSQL regression covers cooperative abort, failed retry,
  invalid timeout configuration, and a non-cooperative sender held beyond the
  original lease. A concurrent retry remains skipped until settlement, then
  sends exactly once.

## Review fix round 3

- Timeout remains a cancellation boundary, not a fabricated delivery result.
  After abort, a still-owned sender's eventual settlement is preserved:
  late success acknowledges `sent`, while late failure/rejection acknowledges
  `failed`.
- Token fencing remains authoritative. If lease ownership is genuinely lost,
  the stale sender returns a safe failure and cannot acknowledge over the
  current owner.
- The PostgreSQL regression now proves late non-cooperative success becomes
  terminal `sent` and the next attempt skips without invoking its sender. It
  separately proves late failure releases the claim and exactly one retry
  succeeds.
