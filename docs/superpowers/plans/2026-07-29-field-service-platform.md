# Field Service Platform Implementation Plan

> Execute sequentially on `main`. Each task begins with a failing focused test,
> implements the smallest complete behavior, verifies it, then commits.

**Goal:** Deliver an assignment-safe field-service platform across the Next.js
backend/web and Flutter app, including evidence, maintenance automation,
dispatch/offline support, and a read-only vendor integration boundary.

**Architecture:** Existing service aggregates remain canonical. New operational
tables add assignment, visits, evidence, automation, and vendor projections.
All client access goes through authenticated server APIs. Flutter consumes
assignment-filtered endpoints and reuses the existing mutation queue.

**Stack:** Next.js 16, TypeScript, Drizzle/Postgres/Supabase, Bun tests, Flutter,
Riverpod, `mobile_scanner`, `image_picker`.

---

## Task 1: Technician role and assignment-aware authorization

**Files**

- Modify: `src/db/schema.ts`
- Create: `drizzle/0064_field_service_foundation.sql`
- Modify: `src/lib/actions/common.ts`
- Modify: `src/lib/mobile/auth.ts`
- Modify: `src/lib/auth/mobile-permissions.ts`
- Modify: `src/lib/auth/cashier-pin.ts`
- Modify: `src/lib/schemas/settings.ts`
- Create: `src/lib/services/access.ts`
- Test: `tests/service-access.test.ts`
- Test: `tests/mobile-permissions.test.ts`

**Steps**

1. Add failing tests for `technician`, direct `service.field` permission, denied
   commercial permissions, and owner/manager/assigned/crew access decisions.
2. Extend the shared role model and settings validation.
3. Add `service_job_assignments` with unique `(job_id, profile_id)`, assignment
   role, timestamps, indexes, RLS, and revoked direct client privileges.
4. Implement pure access-policy helpers and DB-backed job access resolution.
5. Add `requireMobileServiceAccess`.
6. Run focused tests and migration schema test; commit.

## Task 2: Field operation schema and domain rules

**Files**

- Modify: `drizzle/0064_field_service_foundation.sql`
- Modify: `src/db/schema.ts`
- Modify: `src/lib/services/domain.ts`
- Modify: `src/lib/services/schemas.ts`
- Test: `tests/service-domain.test.ts`
- Test: `tests/service-field-schema.test.mjs`

**Steps**

1. Add failing tests for visit transitions, evidence requirements, signature
   hashing input, SLA deadlines, and idempotency.
2. Add assignments, visits, time entries, attachments, signatures, job events,
   maintenance occurrences, customer requests/SLA, and camera projection tables.
3. Add checks, foreign keys, unique idempotency constraints, indexes, RLS, and
   revoke direct `anon`/`authenticated` access with Supabase-role guards.
4. Add Zod schemas and pure domain functions.
5. Apply migration with `bun run src/db/apply-migrations.ts`, rerun to prove zero
   pending, query every new table/critical column, and run Supabase advisors.
6. Commit schema and domain.

## Task 3: Assignment-filtered service query/API

**Files**

- Modify: `src/lib/data/services.ts`
- Create: `src/lib/data/service-field.ts`
- Modify: `src/app/api/mobile/services/jobs/route.ts`
- Create: `src/app/api/mobile/services/jobs/[id]/route.ts`
- Test: `tests/service-field-api.test.mjs`

**Steps**

1. Add DB-backed tests showing technicians receive only assigned jobs while
   managers receive all jobs.
2. Implement Today/Week filters using server timezone and assignment predicates.
3. Return job detail with checklist, safe site/customer fields, crew, materials,
   assets, evidence metadata, visits, signatures, and timeline. Exclude cost and
   margin for technicians.
4. Verify unauthorized/unassigned access is `403`/`404` without data leakage.
5. Commit.

## Task 4: Visits, checklist, assets, evidence, signature, completion

**Files**

- Create: `src/lib/services/field-operations.ts`
- Create routes below `src/app/api/mobile/services/jobs/[id]/`
- Create: `src/lib/services/evidence-storage.ts`
- Test: `tests/service-field-operations.test.mjs`
- Test: `tests/service-evidence.test.ts`

**Steps**

1. Write failing transactional tests for check-in/out, checklist replay,
   asset scan uniqueness, private attachment metadata, signed snapshot hash,
   and completion requirements.
2. Implement idempotent mutation IDs and assignment checks inside each
   transaction.
3. Add private Storage upload with MIME/size/category validation and short signed
   download URLs. Never return service credentials.
4. Hash a canonical document snapshot using SHA-256 before storing a signature.
5. Complete only when checklist/evidence rules pass; append events/audit and
   derive project stage.
6. Run focused tests, lint, and build; commit.

## Task 5: Flutter technician workspace

**Files in `../luma-pos-mobile`**

- Modify: `lib/src/core/api/mobile_endpoints.dart`
- Modify: `lib/src/core/api/mobile_data_repository.dart`
- Modify: `lib/src/core/providers/app_providers.dart`
- Modify: `lib/src/core/widgets/app_shell.dart`
- Create: `lib/src/features/services/domain/service_job.dart`
- Create: `lib/src/features/services/data/service_repository.dart`
- Create: `lib/src/features/services/presentation/service_jobs_screen.dart`
- Create: `lib/src/features/services/presentation/service_job_screen.dart`
- Create: `lib/src/features/services/presentation/service_signature_pad.dart`
- Test: matching files under `test/features/services/`

**Steps**

1. Add failing model, repository, navigation, widget, and signature tests.
2. Implement Today/Week lists and the job workspace.
3. Add status actions, checklist, actual materials, QR asset scan, camera/gallery
   evidence, signature, directions, and completion validation.
4. Add service permissions to Flutter and hide commercial surfaces for the
   technician role.
5. Preserve the user's existing project-detail test changes; stage only service
   files.
6. Run `flutter test`, `flutter analyze`, commit, and push the mobile repo.

## Task 6: Maintenance automation and customer request intake

**Files**

- Create: `src/lib/services/maintenance-worker.ts`
- Modify: `src/app/api/cron/notifications/route.ts`
- Create: `src/app/api/portal/service-request/[token]/route.ts`
- Create: `src/app/portal/service-request/[token]/page.tsx`
- Create: `src/lib/services/customer-request-token.ts`
- Test: `tests/service-maintenance-worker.test.mjs`
- Test: `tests/service-customer-request.test.ts`

**Steps**

1. Add failing tests proving one occurrence/job per `(plan,due_on)`, correct lead
   window, overdue escalation, and scoped expiring portal tokens.
2. Implement the transactional worker and invoke it from the protected existing
   notification cron.
3. Dispatch idempotent push notifications to assignee/managers.
4. Implement request intake with rate limiting, SLA calculation, optional
   evidence, and no cross-scope reads.
5. Verify retries, invalid/expired tokens, lint, and build; commit.

## Task 7: Dispatch, crew, time, and safe offline replay

**Files**

- Create: `src/app/api/mobile/services/dispatch/route.ts`
- Create: `src/app/api/mobile/services/jobs/[id]/assignments/route.ts`
- Create: `src/app/api/mobile/services/jobs/[id]/time/route.ts`
- Modify Flutter service repository/screens and offline policy
- Test: web and Flutter dispatch/offline tests

**Steps**

1. Add failing tests for multi-tech assignment, visit/time state, mutation replay,
   version conflict, and manager metrics.
2. Implement manager-only dispatch/crew APIs and productivity projection.
3. Queue only checklist, visit, evidence metadata, asset scan, and note mutations;
   never queue signing or final completion without confirmation.
4. Surface conflict/current server version in the existing sync center.
5. Add directions deep link without persisting precise location by default.
6. Verify and commit both repos.

## Task 8: Vendor adapter and EZVIZ-safe boundary

**Files**

- Create: `src/lib/camera-vendors/types.ts`
- Create: `src/lib/camera-vendors/adapter.ts`
- Create: `src/lib/camera-vendors/disabled-adapter.ts`
- Create: `src/lib/camera-vendors/ezviz-adapter.ts`
- Create: `src/lib/camera-vendors/sync.ts`
- Create manager-only API routes under `src/app/api/mobile/services/vendors/`
- Test: `tests/camera-vendor-adapter.test.ts`

**Steps**

1. Add contract tests for disabled mode, normalized health/alerts, timeouts,
   redacted errors, rate-limit backoff, and vendor failure isolation.
2. Implement a feature-flagged server-only adapter. Do not invent undocumented
   EZVIZ endpoints; enable HTTP calls only when verified endpoint templates and
   partner credentials are configured.
3. Persist mappings, snapshots, alerts, and sync runs without secrets.
4. Provide vendor-app deep links where configured and expose only normalized
   read-only projections to clients.
5. Document required production credentials/models/region and leave polling
   disabled until those external prerequisites are verified.
6. Run tests, lint, build, and commit.

## Task 9: Final verification and handoff

1. Run focused and full service test suites, DB-backed migration tests, ESLint,
   and `bun run build`.
2. Run the migration runner twice; query new schema and confirm zero pending.
3. Run Supabase security/performance advisors and resolve regressions introduced
   by this work.
4. Run full Flutter tests/analyze.
5. Update the original review document with delivered status and any external
   EZVIZ credential limitation.
6. Inspect both git statuses, commit only owned files, and push `origin/main`.
