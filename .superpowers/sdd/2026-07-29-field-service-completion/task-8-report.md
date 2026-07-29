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
