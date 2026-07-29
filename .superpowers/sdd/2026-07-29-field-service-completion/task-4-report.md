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
