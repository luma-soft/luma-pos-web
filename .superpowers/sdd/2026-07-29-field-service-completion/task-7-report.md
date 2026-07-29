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
