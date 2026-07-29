# Task 7 report — technician warranty requests

## Outcome

- Added an authenticated technician warranty workflow scoped only from a locked
  assigned job and a same-project installed asset.
- Added technician-safe claim list/detail reads; removed technicians immediately
  lose access while owners/managers retain access.
- Added a mobile issue/warranty form for asset, title, description, priority,
  optional private evidence, and optional requested schedule.
- Added transactionally consistent timeline, audit, project-stage update, and
  persistent notifications for active owners/managers.

## Security and evidence

- Technician authorization uses the canonical active primary/crew assignment
  row after locking the job, so concurrent unassignment cannot race creation.
- Client project/claim identifiers are rejected by a strict schema; project,
  job, asset, creator, code, and notification targets are server-derived.
- Migration `0080_technician_warranty_requests.sql` adds claim/asset attachment
  scope, server-write-only manager notifications, and database triggers that
  reject cross-project claims and cross-claim evidence.
- Multipart input uses a bounded Busboy stream with raw total, file, field,
  part, header, and control-field limits. It does not trust `Content-Length`.
- Evidence is stored in a forced-private bucket, byte-sniffed, byte-sized, and
  SHA-256 hashed.
- Before upload, the flow stages the object in the existing durable cleanup
  queue. The authenticated notification cron already drains that queue with
  atomic leases, stale-lease recovery, retries, and idempotent deletion.
- The final DB transaction locks the cleanup row, creates claim/event/audit/
  notifications/attachment, and acknowledges cleanup. Upload, partial, or DB
  failures leave the cleanup row for retry.
- Warranty creation is allowed for an assigned completed job but rejected for
  cancelled jobs. Removed/inactive/unassigned technicians and foreign assets
  are rejected.
- JSON submissions explicitly disable mobile offline queuing so server
  assignment and asset authorization is always current. Task 8 conflict
  semantics were not preempted.

## Verification

- RED observed before implementation:
  - `bun test tests/service-technician-warranty.test.mjs`
  - `flutter test test/features/services/service_warranty_form_test.dart`
  - bounded multipart and durable cleanup tests were also observed failing
    before the hardening implementation.
- Focused and related web tests: 42 passed.
- Affected web ESLint: clean.
- `bun run build`: passed, including TypeScript and all 99 generated pages.
- Migration `0080` applied to the configured database; a second runner reported
  zero pending migrations.
- Direct database verification confirmed `service_attachments.claim_id`,
  `service_attachments.asset_id`, `warranty_claim_notifications`,
  `enforce_warranty_claim_scope()`, `enforce_warranty_attachment_scope()`, and
  the `_migrations` tracking row.
- Affected Flutter analyze: clean.
- `flutter test test/features/services`: 5 passed.

## Compatibility

- Existing manager web/server action behavior is retained.
- No push, deployment, or external credential change was made.
- Web and mobile changes are committed separately, as requested.

## Review fix round 1

- Restored manager compatibility for legacy unlinked claims: `job_id` and
  `asset_id` may both remain null, while partial linkage is rejected. Real
  manager action tests cover null/null create and update.
- Tightened linked claim scope to require the installed asset's exact `job_id`,
  not only the same project. Both the technician core and database guard reject
  same-project cross-job assets.
- Made project/job/asset scope immutable once any claim evidence exists.
  Manager actions map the database invariant to
  `services.errors.warrantyScopeImmutable`.
- Replaced magic-byte-only evidence handling with the Task 5 Sharp pipeline:
  full decode, exact structural/trailing-byte checks, MIME/extension agreement,
  dimension/pixel/page limits, rotation, canonical re-encode, and hashing of
  the sanitized output. Warranty evidence accepts JPEG/PNG/WebP only; PDF,
  truncated, polyglot, and wrong-extension inputs are rejected.
- Added applied migration `0081_technician_warranty_hardening.sql`. It enables
  RLS, revokes app-role table access, revokes trigger-function execution from
  PUBLIC/anon/authenticated, replaces the compatibility/scope guards, and adds
  durable push delivery leases.
- Technician detail and attachment metadata now run inside a transaction that
  locks the canonical job and reauthorizes active primary/crew assignment.
  The attachment signed-URL route also locks, reauthorizes, reads metadata, and
  mints the short-lived URL before releasing that job lock.
- Integrated warranty notifications into the authenticated mobile inbox and
  standard read/dismiss state. The notification cron atomically leases each
  exact owner/manager recipient row, sends with a stable per-row delivery key,
  acknowledges success, and releases failures for retry.
- Added a real two-session PostgreSQL regression proving both lock orderings:
  removal-first blocks then denies the read; read-first returns claim/evidence
  metadata while holding the job lock and blocks removal until commit.
- Verification after review fixes:
  - focused PGlite/action/notification/image tests passed;
  - real PostgreSQL concurrency test passed;
  - affected ESLint passed;
  - production Next.js build passed with TypeScript and all 99 pages;
  - migration runner repeated with zero pending;
  - direct database inspection confirmed RLS, push columns, migration tracking,
    no anon/auth table privileges, and no PUBLIC/anon/auth trigger execution.

## Review fix round 2

- Manager list/detail queries now use nullable asset projections and preserve
  valid legacy `job_id = NULL, asset_id = NULL` claims. Technician queries
  require complete linkage and a current canonical assignment. Real API tests
  cover manager list/detail DTOs and technician 404/exclusion behavior.
- Technician detail now locks the warranty claim row before reading its scope,
  then locks and authorizes the canonical job. The final claim query pins the
  same locked job/asset pair before returning attachment metadata.
- Manager scope updates now run in one transaction with a claim-first lock,
  followed by deterministic sorted old/new job locks, exact job/asset
  validation, and the guarded update. Evidence-scope immutability remains
  enforced.
- The configured two-session PostgreSQL regression now also moves a no-evidence
  claim from assigned job A to unassigned job B. Move-first blocks the reader
  then denies it; read-first returns only A data and blocks the move until
  commit. Both orderings finish without deadlock and never expose B data.
- Push delivery results now distinguish `deferred` quiet-hour work from benign
  device-ledger skips/no-device completion. The service-level warranty
  dispatcher acknowledges only configured deliveries with zero failures and
  zero deferrals; deferred/mixed/failed rows release their lease for retry.
  Stable per-row notification keys preserve per-device deduplication.
- Service-level tests cover all-quiet deferral, mixed sent+quiet deferral, and a
  later benign-ledger retry that finally acknowledges the notification row.
- No migration was needed; applied migrations `0080` and `0081` were not
  modified. Focused tests (15), configured PostgreSQL races, affected ESLint,
  and the production build all passed. Mobile remained unchanged and clean.
