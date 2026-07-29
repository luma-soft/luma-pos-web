# Task 5 report — customer portal and SLA

## Outcome

- Customer request submission is now one-time while the opaque token remains
  status-viewable until expiry. Submission preserves the `new` status instead
  of incorrectly self-triaging.
- Public GET returns a deliberately small customer DTO: request/project
  labels, public status, priority after submission, SLA timestamps, and submit
  eligibility. It does not return internal notes, IDs, contacts, attachment
  paths, hashes, or staff data.
- Public page, GET, POST, and upload paths use PostgreSQL-backed fixed-window
  limits keyed by the token hash and, when supplied by the trusted deployment
  proxy, client IP. Limits therefore apply across application instances.
- Optional evidence is kept in a dedicated private Storage bucket. The server
  enforces an 8 MiB limit, at most three files, detects MIME from file bytes,
  verifies structural trailers, rejects active/polyglot signatures, generates
  its own storage extension/path, hashes SHA-256, and persists durable
  metadata. Failed/racing database writes remove the uploaded object.
- Submission transactionally computes response/resolution deadlines from the
  active priority SLA policy and creates one durable notification per active
  owner/manager. Inactive staff are excluded and replay cannot notify twice.
- Manager-only APIs and the Services customer-request tab provide list,
  detail, private signed evidence URLs, triage/status transitions, internal
  notes, same-project job linking, and independent response/resolution overdue
  visibility.
- Status transitions are constrained and operational states require a linked
  job. The first manager response and resolution timestamps stop their
  respective SLA clocks.

## TDD evidence

### RED

1. `bun test tests/service-customer-request.test.ts`
   - Failed because explicit submit/view eligibility, byte-sniffing,
     independent SLA state, and request transition behavior did not exist.
2. `bun test tests/service-customer-request-portal.test.mjs`
   - Failed because the portal domain/schema were absent.
3. The cross-project regression failed with
   `cross-project job link was accepted` before the manager mutation core
   enforced project scope.

### GREEN

- `bun test tests/service-customer-request.test.ts
  tests/service-customer-request-portal.test.mjs
  tests/service-field-schema.test.mjs`
  - Exit 0. Covers opaque token hashing, submit/view split, expiry, replay,
    MIME spoof/polyglot/truncation, SLA state, transition constraints,
    same-project scope, active manager notification targets, durable rate
    limit, evidence metadata, RLS, and ACL.
- Changed-file ESLint
  - Exit 0.
- `bun run build`
  - Exit 0; compilation, TypeScript, 98-page generation, and all new routes
    passed.
- `bun test`
  - Exit 0. The repository's current default test discovery executed the
    product PGlite suite (22 checks); focused Task 5 suites were run explicitly
    because some legacy script suites terminate their process.

## Migration verification

- Migration `0077_service_customer_request_portal.sql` applied successfully.
- Immediate rerun reported zero pending migrations.
- Direct configured-database queries confirmed:
  - request columns `submitted_at`, `responded_at`, `resolved_at`,
    `linked_job_id`, `triaged_by`, and `internal_note`;
  - tables `service_customer_request_attachments`,
    `service_customer_request_notifications`, and
    `service_public_rate_limits`;
  - RLS enabled on all new tables;
  - `anon` and `authenticated` have neither SELECT nor INSERT privilege on
    the new tables.

## Remaining concerns

- Byte-level PDF validation rejects common active-content and polyglot
  signatures but is not a malware scanner. Storage remains private and manager
  access is through ten-minute signed URLs; deployments requiring antivirus
  quarantine should add a scanner before allowing broader file types.
- Rate-limit rows have durable expiry metadata and indexed cleanup readiness.
  A future housekeeping worker may delete expired buckets to reduce table
  growth; correctness does not depend on deletion.
- Durable manager notifications are recorded in the service notification
  table. Delivery through optional external channels would need a separate
  idempotent delivery worker and credentials.
