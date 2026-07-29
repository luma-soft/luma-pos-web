# Task 8 report — optimistic field concurrency and conflict recovery

## Outcome

- Added database-owned revisions for the mutable service job, checklist, asset
  collection, material, and installed-asset state.
- Checklist, material-usage, and installed-asset creation requests now require
  `expectedVersion`. The canonical job/material row is locked before comparing
  the version and applying the mutation.
- Stale writes return an authenticated `409` with only `resourceType`,
  `resourceId`, `currentVersion`, `updatedAt`, and the minimum refresh data for
  that resource.
- Exact `clientMutationId` replay returns its original result even after the
  version advances. Reusing the ID with a different payload remains a conflict.
  Canonical assignment authorization still runs before replay lookup, so a
  removed technician cannot replay or recover another assignment's result.
- Mobile checklist, material, and asset mutations persist their expected
  revision in the durable outbox. Visits, evidence, signatures, completion, and
  technician warranty submission remain online-only rather than silently
  overwriting sensitive state.
- Sync Center persists safe conflict metadata and exposes three explicit
  recovery actions: refresh from the authorized job endpoint, retry the user's
  mutation with the newly confirmed version, or discard it. Conflict rows are
  never automatically retried.
- No automatic merge is performed. Checklist/material changes can be retried
  only after an explicit refresh and user action; job/asset/signature/
  completion/evidence state is never last-write-wins.

## Schema and locking

- Applied immutable migration `0082_service_field_versions.sql`:
  - `service_jobs.version`
  - `service_jobs.checklist_version`
  - `service_jobs.assets_version`
  - `service_job_materials.version`
  - `installed_assets.version`
  - positive-value checks and database triggers that own every increment.
- Applied immutable follow-up migration
  `0083_service_asset_version_timestamp.sql` so asset collection changes also
  advance the parent job's `updated_at`.
- Asset insert/update/delete increments the parent collection revision. Direct
  job/checklist, material, and installed-asset updates also advance revisions,
  including manager paths outside the mobile field endpoints.
- Trigger helpers have `search_path = public, pg_temp`; execute is revoked from
  PUBLIC, `anon`, and `authenticated`. Direct database inspection shows only
  `postgres` and `service_role` execute ACLs.

## TDD and verification

- RED was observed in the new PGlite suite when revisions were absent.
- `bun test tests/service-offline-conflicts.test.mjs`: pass. It covers stale
  checklist/material/asset versions, safe 409 shape, original-result replay,
  changed-payload rejection, rejected-receipt rollback, and assignment-removal
  isolation.
- Changed-file ESLint: no errors (two pre-existing warnings remain in
  `tests/service-field-operations.test.mjs`).
- `bun run build`: pass, including TypeScript and all 99 generated pages.
- Migration runner applied `0082` and `0083`; the repeated run reports zero
  pending. Direct inspection confirmed all five columns, constraints/triggers,
  both migration rows, timestamp behavior, and restricted function ACLs.
- `flutter analyze lib`: no issues.
- Focused Flutter suites cover durable conflict persistence, expected-version
  replacement, API 409 capture, refresh ordering, explicit retry, discard,
  sensitive-operation no-queue policy, model versions, and Sync Center UI.
- The final full `flutter test` run passed all 461 tests. An earlier run exposed
  one obsolete field-service policy expectation; it was updated to require a
  version and keep visits online-only before the clean rerun.

## Compatibility and delivery

- SQLite schema version advances from 5 to 6 and upgrades existing durable
  queues in place with nullable conflict JSON and a refresh marker.
- The API client preserves structured error details only for recovery logic;
  Sync Center never renders raw mutation bodies or private response data.
- No push or deployment was performed. Web and mobile changes are committed
  separately as requested.

## Review fix round 1

- Auto/bulk queue flushes now exclude every persisted `409` row. A normal
  successful GET and `syncAll` leave its conflict JSON and refresh marker
  untouched across process close/reopen. Refresh performs only the authorized
  GET; the subsequent explicit retry sends exactly the selected mutation once.
  If that retry receives a newer `409`, another refresh is required.
- Mobile regression coverage now includes SQLite v5→v6 upgrade, real
  close/reopen persistence, auto-sync exclusion, normal-GET exclusion,
  refresh-without-send, selected retry, newer-conflict reset, and actor-scoped
  discard. Focused tests pass 34/34 and the full Flutter suite passes 465/465.
- Applied immutable migration
  `0084_service_version_canonical_changes.sql`. Job, checklist, material,
  installed-asset, and asset-collection counters now use canonical
  `IS DISTINCT FROM` comparisons. `updated_at`, caller-supplied revisions,
  housekeeping writes, and no-op saves do not advance client revisions.
  Asset insert/delete advances the collection once; a meaningful asset update
  advances the row and collection once; an identical asset save advances
  neither.
- `updateServiceJob` now locks and synchronizes primary-assignment rows first,
  then writes assignee plus manager-editable job fields in one canonical
  `service_jobs` update. A combined assignee/content save advances the job
  revision exactly once; an identical manager save does not advance it.
  Identical material upserts and installed-asset saves likewise preserve their
  revisions.
- Real PostgreSQL tests with two independent sessions verify single-winner
  same-version checklist, material, and asset-collection writes. Existing
  independent-session visit/assignment coverage also passes, including lock
  ordering and removed-assignment isolation.
- Migration `0084` applied successfully; a second migration-runner execution
  reports zero pending. Focused PGlite/PostgreSQL suites and production build
  pass. The full web test command still reports unrelated pre-existing suite
  failures, chiefly legacy PGlite fixtures that do not create the
  `anon`/`authenticated` roles required by migration `0081`, plus existing UI
  audit failures outside Task 8.

## Review fix round 2

- Applied immutable migration
  `0085_service_assets_version_ownership.sql`; migrations through `0084`
  remain unchanged.
- The `service_jobs` revision trigger now runs before both INSERT and UPDATE.
  Every direct INSERT is normalized to `version = 1`,
  `checklist_version = 1`, and `assets_version = 1`, even when the caller
  supplies explicit inflated values.
- On a top-level job UPDATE, caller attempts to inflate, reset, or decrement
  `assets_version` are ignored. A nested trigger write may leave the collection
  revision unchanged or advance it by exactly one; every other nested delta is
  rejected with `SERVICE_ASSETS_VERSION_INVALID_DELTA`.
- The installed-assets collection trigger remains the owner of collection
  increments. Real PostgreSQL tests verify exact `+1` behavior for asset
  insert, canonical update, move between jobs, and delete, while an
  `updated_at`-only asset update does not advance the collection.
- RED was observed on the applied `0084` database: an INSERT supplying all
  three revisions as `77` persisted them as `77`. After applying `0085`, the
  ownership suite passes, including explicit INSERT values, direct
  inflate/reset/decrement attempts, and rejection of a nested `+2` write.
- Focused real-PostgreSQL suites pass for version ownership, stale-write
  concurrency, manager no-op/exact bumps, and visit/assignment lock isolation.
  Production build and targeted ESLint pass. Direct catalog inspection confirms
  the trigger is `BEFORE INSERT OR UPDATE`, the function ACL remains restricted
  to `postgres` and `service_role`, migration `0085` is tracked, and a repeated
  migration run reports zero pending.
