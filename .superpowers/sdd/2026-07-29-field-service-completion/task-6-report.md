# Task 6 report — dispatch and manager reporting

## Outcome

- The manager dispatch API now supports half-open Today/Week or explicit
  ranges, bounded to 31 days, with deterministic pagination capped at 100
  rows. Status, priority, technician/crew, unassigned, SLA overdue, and
  maintenance overdue filters compose with AND semantics.
- Date-only manager inputs are interpreted at Asia/Ho_Chi_Minh midnight;
  explicit ISO instants remain unchanged. The web dispatch view groups the
  selected rows by local day and exposes Today and seven-day views.
- Manager-only service reporting is bounded to 93 days and paginated. It
  returns scheduled-cohort totals, completions/rate, overdue SLA and
  maintenance counts, completed work minutes, visit count, and job detail.
- First-time completion is reported only when supportable. Its documented
  denominator is completed jobs with at least one completed visit; its
  numerator is those jobs with exactly one completed visit. With no eligible
  denominator the API/UI says the metric is unavailable rather than returning
  a fabricated rate.
- Both mobile endpoints require owner/manager authorization before parsing or
  querying. Dispatch and report DTOs deliberately omit costs, material
  financials, contact phone, assignment history, and unrelated staff.
- Assignment upsert/removal now locks the job and commits assignment rows,
  `service_jobs.assigned_to`, job timeline events, and general audit logs in a
  single transaction. Primary assignment continues through the Task 3
  serialized one-primary helper; crew assignment cannot demote the active
  primary implicitly.
- No schema change or migration was needed.

## TDD evidence

### RED

1. `bun test tests/service-dispatch-reporting.test.ts`
   - Failed because the dispatch/report query and metric semantics module did
     not exist.
2. The local-date boundary assertion failed because native date-only parsing
   treated `2026-07-29` as UTC midnight instead of Ho Chi Minh midnight.
3. The first configured-PostgreSQL fixture was rejected with
   `SERVICE_VISIT_STATUS_INVALID`; the Task 3 database guard correctly
   prevented adding visits after completion. The fixture was corrected to
   create visits while jobs were actionable and only then complete them.

### GREEN

- `bun test tests/service-dispatch-reporting.test.ts
  tests/service-dispatch-authorization.test.ts tests/service-access.test.ts`
  - 13 tests pass, covering filter combinations, invalid/oversized ranges,
    abusive pagination, exact local/UTC boundaries, meaningful/unavailable
    first-time completion, and authorization before query execution.
- `bun --env-file=.env.local test
  tests/service-dispatch-reporting-postgres.test.mjs`
  - Configured PostgreSQL verifies combined technician + urgent + SLA overdue
    + maintenance overdue filtering, exact safe DTO shape, totals, completion,
    three visits, 90 work minutes, first-time completion 1/2, and transactional
    primary removal across job, assignment, event, and audit rows.
- `bun --env-file=.env.local test
  tests/service-visit-concurrency-postgres.test.mjs`
  - Existing independent-session assignment/visit races remain green with the
    new assignment core. Its cleanup now removes the Task 6 audit rows before
    deleting fixture profiles.
- Changed-file ESLint passes.
- `bun run build` passes compilation, TypeScript, route collection, and 99-page
  generation including `/api/mobile/services/reports`.

## Metric semantics

- Cohort: jobs whose `scheduled_at` lies in `[from, to)`.
- Completion rate: completed cohort jobs / all cohort jobs.
- SLA overdue: a cohort job linked to at least one non-closed/non-void request
  whose unanswered response deadline or unresolved resolution deadline has
  passed.
- Maintenance overdue: a cohort job linked to an overdue occurrence, or a
  scheduled occurrence whose due date is before the current Ho Chi Minh date.
- Work time and visits: completed time entries and completed visits attached
  to cohort jobs.
- First-time completion: completed cohort jobs with exactly one completed
  visit / completed cohort jobs with at least one completed visit.

## Remaining concerns

- Reporting is an operational scheduled-job cohort, not a payroll or financial
  report. Travel/open time entries and monetary service costs are intentionally
  excluded.
- The web report date selector labels the upper bound as “Đến trước ngày” to
  make the half-open range explicit. API consumers should send ISO instants
  when they need a boundary other than Ho Chi Minh midnight.

## Review fix round 1

The first independent review found three Important consistency/contract gaps;
all three are addressed without a schema change:

- Dispatch rows/count and report metrics/detail now execute sequentially on
  the same read-only `REPEATABLE READ` transaction. A reusable snapshot reader
  keeps the isolation contract explicit and permits deterministic integration
  coordination without adding timing hooks to query production code.
- Date-only values still map to Asia/Ho_Chi_Minh midnight. Timestamp values
  must now end in `Z` or a numeric `±HH:MM` offset. Offsetless datetimes and
  malformed values are rejected before `Date` parsing, so server `TZ` cannot
  change their meaning.
- Service pagination now follows the shared component's canonical `size` URL
  key. Legacy `limit` remains accepted for API compatibility; conflicting
  simultaneous values are rejected. Dispatch and report panels explicitly
  offer 20, 50, and 100 rows.

### Review-fix RED/GREEN evidence

- RED:
  - `size=20` remained at the old default of 50;
  - conflicting `size`/`limit` did not fail;
  - offsetless timestamps inherited the process timezone;
  - rows/count and metrics/detail used separate database snapshots.
- GREEN:
  - Domain suite covers 20/50/100 for both parsers, canonical URL emission,
    conflict rejection, three process timezone settings, explicit UTC, local
    date-only boundaries, and negative offsetless/malformed inputs.
  - Configured PostgreSQL concurrency calls the real dispatch/report functions.
    A separate connection commits an insert after dispatch rows but before
    count; the response remains one row/total one/page count one. A separate
    update changes a job after report metrics but before detail; metrics and
    returned detail both retain the pre-update status from one snapshot.
  - Original configured-PostgreSQL filters/metrics/assignment integration
    remains green.
