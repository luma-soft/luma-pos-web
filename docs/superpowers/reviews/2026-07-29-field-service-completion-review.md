# Field Service Completion Review

**Date:** 2026-07-29
**Scope:** LumaPOS web/backend and Flutter mobile field-service platform
**Verdict:** Implementation complete; final integrated verification recorded
below
**Vendor boundary:** Live EZVIZ polling remains disabled until official partner
credentials and regional endpoint documentation are available.

## Requirement closure

| # | Area | Delivered invariant | Primary evidence |
|---|---|---|---|
| 1 | Evidence deletion | Signed evidence cannot be deleted; unsigned evidence is tombstoned transactionally and Storage cleanup is leased/idempotent. | Evidence deletion PGlite suite and migrations `0065–0066` |
| 2 | Signed handover | Server builds and hashes the canonical snapshot; stale or invalidated signatures cannot complete a job; terminal handovers cannot be replaced through either the core or direct database writes. | Signed-snapshot suite and migrations `0067–0070`, `0088` |
| 3 | Visits and field state | Actionable check-in only, one active visit, exact checkout, terminal guards, assignment reauthorization and real lock-order tests. | Visit state/concurrency suites and migrations `0071–0074` |
| 4 | Maintenance | One outstanding occurrence/job, transactional completion and monotonic cycles, exact technician/manager notifications and durable push claims. | Maintenance manager/concurrency/push suites and migrations `0075–0076` |
| 5 | Customer portal and SLA | One-time submit plus status view, streaming/canonical private photos, durable rate limits/cleanup, manager triage and SLA. | Portal/multipart/job-lock suites and migrations `0077–0079` |
| 6 | Dispatch and reporting | Manager-only calendar/filter UI, bounded consistent-snapshot metrics and transactional assignment audit. | Dispatch domain/PostgreSQL snapshot suites |
| 7 | Technician warranty | Assigned technicians can create scoped claims with canonical private photos; managers receive inbox/push notifications. | Warranty manager/IDOR/concurrency suites and migrations `0080–0081` |
| 8 | Offline conflicts | Server-owned revisions, safe stale `409`, replay fingerprints, paused conflicts and explicit refresh/retry/discard. | Offline conflict/concurrency/ownership suites and migrations `0082–0087` |

## Security and reliability decisions

- All job-scoped technician access is derived from the authenticated actor and
  revalidated after the canonical job lock.
- Evidence is private. Public portal and technician warranty photos are decoded
  and re-encoded before hashing and Storage persistence.
- Multi-table mutations use transactions; external Storage/push work uses
  durable claim, lease, token and retry state.
- Public portal rate limiting uses durable global and token/action buckets and
  does not trust caller-controlled forwarding headers.
- Revision counters are database-owned. The installed-asset collection counter
  is owned by a private RLS-protected authority table and mirrored to jobs.
- Conflict payloads contain only the minimum authorized refresh state. Sensitive
  signature, completion, evidence and visit operations are never auto-queued.
- EZVIZ credentials, undocumented endpoints and live polling are not present in
  client code or enabled configuration.

## Migration record

- Field-service completion migrations: `0065` through `0088`.
- Applied migrations are immutable.
- The migration runner was executed twice against the configured PostgreSQL
  database; both runs reported zero pending migrations.
- Direct catalog checks confirmed the installed-device `ip_address`, active
  visit unique index, RLS on the private asset-revision authority, and no
  `service_role` table access or function execution on that authority.

## Final verification record

Fresh verification against the delivery source state:

- Web Field Service suite: 21 files, zero failures, including PGlite and real
  PostgreSQL concurrency coverage.
- Full web suite: all 124 test files passed in isolated Bun processes. Isolation
  is required because legacy script-style tests call `process.exit` and several
  Bun module mocks are process-global; a single shared process can terminate
  early or leak mocks between otherwise-passing files.
- Production build: `next build` completed, including TypeScript and all 99
  static-page generation steps.
- ESLint: explicit `src` and `tests` targets completed with zero errors and two
  pre-existing warnings (React Hook Form compiler compatibility and an unused
  test destructure). The two Field Service unused-variable warnings found
  during delivery were removed. The repository-wide default command remained
  CPU-bound without output for more than three minutes, so the delivery check
  uses those explicit source/test targets.
- Client bundle inspection: 82 JavaScript chunks scanned with zero configured
  secret-value matches. The only configuration-name literal is `DATABASE_URL`
  in the existing generic app-error help copy; no database URL, Supabase
  service-role key, EZVIZ token, or EZVIZ endpoint value is present.
- Flutter: all 20 Dart files changed by this delivery are formatted; `flutter
  analyze lib` reported no issues; all 465 tests passed.
- Flutter repository-wide format check identified 17 pre-existing formatting
  drifts outside this delivery and made no writes (`--output=none`).
- Migration runner: migration `0088` applied followed by a zero-pending run.
  Direct PostgreSQL audit: 25 migration records in the `0065–0088` filename
  range (24 Field Service plus
  the separate `0065_store_settings_baseline_repair.sql`), installed-device IP
  column present, active-visit index present, private revision table present
  with RLS, and `service_role` authority access denied.

## Final review closure

The final read-only acceptance review found one Important issue: an assigned
technician could supersede an active signature after a job had already reached
`completed`. The delivery now rejects new terminal-job signatures after the
locked idempotency lookup and migration `0088` blocks direct
`INSERT`/`UPDATE`/`DELETE` on terminal-job signature rows. Regression coverage
proves core replacement and direct database mutation are both rejected while
exact idempotent replay remains available.
