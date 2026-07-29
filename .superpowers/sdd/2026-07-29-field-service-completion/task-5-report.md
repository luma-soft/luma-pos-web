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

## Review fix round 1

The independent review found one Critical and five Important gaps. This round
addresses all six:

- Evidence is photo-only. JPEG, PNG, and WebP must match declared MIME and
  extension, pass exact container-boundary validation, and fully decode through
  Sharp under 8 MiB, 6000×6000, and 20-million-pixel limits. The server rotates
  and re-encodes canonical bytes without input metadata before computing the
  persisted SHA-256. PDF support was removed.
- Public limits no longer use forwarding headers. Fixed route-global buckets
  provide a non-bypassable ceiling and valid token-hash buckets provide
  per-link limits. Invalid/guessed tokens never create token-specific buckets.
  This covers page, GET, and the combined submit/upload POST.
- Migration `0078_service_customer_request_security.sql` adds a validated
  operational-state/job constraint and a trigger that rejects cross-project
  links even for direct SQL writers. The application rejects an unlink if the
  resulting status requires a job, and the UI does not offer that unlink.
- Reopening `resolved -> in_progress` transactionally clears `resolved_at`.
  Resolution overdue calculation therefore resumes against the original
  deadline.
- Stored contact name/phone and stored request title are no longer selected or
  hydrated into the public client component. New submissions begin with blank
  contact inputs; the public status payload remains a minimal bearer-token DTO.
- The old one-file-at-a-time endpoint was removed. A single multipart request
  validates and canonicalizes all photos before any upload. Cleanup intents
  are durably committed before Storage writes; the final transaction locks
  those intents, persists all evidence metadata, submits the request, creates
  manager notifications, and acknowledges cleanup together. Partial upload or
  finalization failure remains unsubmitted and manager-invisible.
- The existing authenticated notification cron now drains orphan cleanup rows.
  Cleanup uses token-fenced five-minute claims, retry backoff, and idempotent
  missing-object removal. Finalization locks cleanup ownership, so a cleaner
  can never race a committed attachment into a missing object.

### Review-fix RED/GREEN evidence

- RED:
  - decoder/dimension/canonicalization exports were absent;
  - `resolved -> in_progress` retained `resolved_at`;
  - an operational request could unlink its job;
  - manager core could triage an unsubmitted partial upload;
  - finalization could commit while cleanup owned the object.
- GREEN:
  - `bun test tests/service-customer-request.test.ts`
    - 8 tests, 60 assertions, including real generated image fixtures,
      truncation, SVG/ZIP marker wrapping, trailing payload, MIME/extension
      mismatch, dimension/decompression limits, PII hydration, and forwarding
      header rotation.
  - `bun test tests/service-customer-request-portal.test.mjs`
    - PGlite covers atomic success, partial multi-file failure, cleanup
      retry/backoff/replay, cleanup/finalization fencing, unsubmitted manager
      isolation, reopen SLA, direct unlink constraint, and direct
      cross-project trigger.
  - Focused field schema, changed-file ESLint, and `bun run build` pass.

### Migration 0078 verification

- Applied successfully; immediate rerun reported zero pending migrations.
- Direct configured-database checks confirmed:
  - `width`/`height` image metadata columns;
  - validated `service_customer_requests_operational_job_check`;
  - enabled `service_customer_requests_job_scope_trigger` and backing function;
  - cleanup table and retry index;
  - cleanup RLS enabled;
  - no anon/authenticated SELECT or INSERT cleanup privilege;
  - `_migrations` contains `0078_service_customer_request_security.sql`.

## Review fix round 2

The second review accepted all prior fixes and identified two remaining
boundaries. Both are now closed:

- Public multipart parsing uses the explicitly declared Busboy dependency over
  `request.body`; `request.formData()` is no longer used. A Transform counts
  authoritative raw bytes and aborts above the total ceiling regardless of
  missing or forged `Content-Length`.
- Parser limits independently cap total bytes, file bytes, file count, control
  fields, field bytes, total parts, field-name bytes, and header pairs. Only
  the five exact one-time controls and up to three `evidence` files are
  accepted. Duplicate/unknown controls, unknown file fields, truncation, and
  all limit events destroy the source/limiter and reject before image
  sanitization or persistence.
- Migration `0079_service_customer_request_job_locking.sql` serializes request
  linking with job project moves. The request trigger locks its target job
  before comparing projects. The job-move trigger runs under the job row lock
  and performs a read-only linked-request existence check; it never waits on a
  request row. Thus the only wait edge is request → job and no job → request
  edge exists.
- Both trigger functions have PUBLIC, anon, and authenticated EXECUTE revoked.

### Review-fix RED/GREEN evidence

- RED:
  - the streaming parser module did not exist;
  - direct SQL allowed a linked job to move to another project.
- GREEN:
  - `bun test tests/service-customer-request-multipart.test.ts`
    - normal chunked multipart success with no length;
    - missing-length oversized stream;
    - forged low length;
    - oversized unexpected file field;
    - duplicate controls, excess fields, and excess parts.
  - Combined focused suite:
    - 13 tests, 72 assertions, plus PGlite scripts.
  - `bun --env-file=.env.local test
    tests/service-customer-request-job-concurrency-postgres.test.mjs`
    - real configured PostgreSQL verifies both lock interleavings without
      deadlock: link-first rejects the waiting move, and move-first rejects the
      waiting link.

### Migration 0079 verification

- Applied successfully; immediate rerun reported zero pending migrations.
- Direct configured-database checks confirmed:
  - both trigger functions exist and have active triggers;
  - PUBLIC, anon, and authenticated cannot execute either trigger function;
  - `_migrations` contains `0079_service_customer_request_job_locking.sql`.
