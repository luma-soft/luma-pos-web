# Field Service Completion Plan

## Global Constraints

- Work on `main`; preserve and never stage unrelated web inventory changes or
  mobile Project Detail work.
- Follow TDD for every behavior: observe a focused failing test before changing
  production code, then run it green.
- Authenticate every job-scoped API and resolve assignment server-side.
- Multi-table mutations are transactional and replayable mutations use
  `clientMutationId`.
- Evidence and signatures must never be lost or trusted from client-owned
  business snapshots.
- EZVIZ stays disabled by default; never invent endpoints, credentials, or data.
- New schema uses migration `0065` or later with constraints, indexes, RLS, and
  guarded revoke statements. Never edit applied migration `0064`.
- Finish with focused/full web and Flutter verification, migration apply twice,
  direct schema checks, documentation updates, scoped commits, and pushes to
  each repo's `origin/main`.

## Task 1: Protect attachments and signatures

- Reject deletion of any attachment referenced by `service_signatures` with a
  business `409`.
- Only the creator or owner/manager may delete unsigned evidence.
- Lock deletion after job completion/cancellation except an explicit audited
  owner path.
- Order DB/Storage operations so a DB failure cannot leave a signature pointing
  at a missing object, and a Storage failure keeps recoverable metadata.
- Append a job event after successful deletion.
- Cover normal deletion, signed evidence, foreign creator, Storage failure, and
  DB failure.

## Task 2: Make signed snapshots server-owned

- Build the canonical snapshot from authoritative job/project/checklist/assets/
  evidence data, including serial, MAC, IP, location, signer, server time, and
  schema version.
- Ignore/remove client-owned `document`; hash and persist the server snapshot.
- Completion verifies signature ownership, hash, and snapshot freshness.
- Mutations after signing must either be rejected or invalidate the signature
  with an audit trail and require re-signing.
- Cover forged project/checklist/assets and stale signed snapshots.

## Task 3: Complete visit and field mutation state machines

- Permit check-in only for actionable states; reject completed/cancelled jobs.
- Enforce at most one active visit per `(job, technician)` under concurrency.
- Close the matching visit/time entry on checkout.
- Allow a new visit for an in-progress job with no active visit.
- Reject completion while a visit/time entry is open.
- Reject checklist/material/asset/evidence changes after completion/cancellation.
- Cover second visits, concurrency, replay, terminal states, and open completion.

## Task 4: Complete maintenance lifecycle

- Link plan, occurrence, and generated job.
- Completing a generated job completes the occurrence and advances
  `lastCompletedOn`/`nextDueOn` by `intervalDays`.
- Mark overdue occurrences and notify both assigned technicians and managers;
  overdue manager escalation is idempotent.
- Retry never duplicates occurrence/job.
- Give maintenance plans a concrete service type; mixed projects must not
  silently become camera work.
- Cover consecutive cycles, overdue, retry, and notification targets.

## Task 5: Complete customer portal and SLA

- Support optional private, sniffed, size-limited, hashed request evidence.
- Submission stays `new`, notifies managers, and is one-time.
- The token remains status-viewable until expiry without exposing internal data.
- Separate submit eligibility from view eligibility and rate-limit public APIs.
- Add manager list/triage/link/status APIs and UI with response/resolution SLA
  visibility and overdue detection.
- Cover invalid/expired/replayed/cross-scope tokens, malicious uploads, and rate
  limiting.

## Task 6: Complete dispatch and manager reporting

- Add calendar/day and Today/Week views with status, priority, technician,
  unassigned, SLA, and overdue maintenance filters.
- Make assignment removal transactional across assignment, primary assignee,
  timeline, and audit.
- Add paginated/range-limited metrics for totals, completion, overdue, work time,
  visits, and first-time completion where supportable.
- Never expose financial or unrelated staff data to technicians.
- Cover authorization, filters, metrics, and assignment consistency.

## Task 7: Let assigned technicians create warranty requests

- Scope asset/project/job from an assigned job; reject all client-supplied
  cross-project identifiers.
- Add mobile issue/warranty form with asset, title, description, priority,
  optional evidence, and optional requested schedule.
- Create timeline/audit and manager notification.
- Technicians may only view requests related to assigned work.
- Cover IDOR, cross-project, unassigned actors, and attachment scope.

## Task 8: Add optimistic field concurrency and conflict UX

- Add suitable revisions for job/checklist/material/asset field state.
- Offline mutations send `expectedVersion`; stale writes return a safe `409`
  containing current version, resource type, update time, and minimum refresh
  data.
- Sync Center supports refresh from server, retry, and discard; never
  auto-overwrite signature/completion.
- Only merge checklist/material changes under explicit tested rules.
- Cover stale versions, replay, safe conflict payload, refresh/retry, and
  cross-user isolation.

## Final Verification and Delivery

- Web: focused tests, PGlite suites, `bun test`, changed-file ESLint,
  `bun run build`, secret/client-bundle inspection.
- Mobile: focused tests, `dart format`, `flutter analyze lib`, `flutter test`.
- Apply migration with `bun run src/db/apply-migrations.ts`, rerun for zero
  pending, and query every new table/column/index/constraint.
- Update the design and original review documents, stage only owned files,
  commit coherent web/mobile changes, push both `origin/main`, and audit every
  acceptance criterion before declaring completion.
