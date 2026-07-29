# Task 2 report — server-owned signed snapshots

Status: DONE_WITH_CONCERNS

## Scope implemented

- Removed `document` and `documentId` from the accepted signature request.
- Removed the client-built business snapshot from the Flutter request.
- Built schema-versioned canonical snapshots inside the signing transaction from
  authoritative project, job, checklist, installed asset, active evidence, and
  signer data.
- Included serial number, MAC address, IP address, and location label.
- Persisted the canonical JSON snapshot and its SHA-256 hash.
- Verified snapshot ownership, hash integrity, schema version, invalidation
  state, and freshness before completion.
- Invalidated signed snapshots transactionally after authoritative project, job,
  asset, or evidence mutations and appended
  `job.signature_invalidated` events.
- Serialized signing/completion and trigger-driven invalidation with a job row
  lock to close the mutation/signing race.
- Revoked direct execution of all new invalidation functions from `PUBLIC`,
  `anon`, and `authenticated`.

## TDD evidence

RED:

```text
bun test tests/service-signed-snapshot.test.mjs
AssertionError: Expected values to be strictly equal:
undefined !== 1
at persistedSignature.snapshotSchemaVersion
```

GREEN and focused regression:

```text
bun test tests/service-signed-snapshot.test.mjs \
  tests/service-field-operations.test.mjs \
  tests/service-evidence.test.ts \
  tests/service-domain.test.ts \
  tests/service-field-schema.test.mjs \
  tests/service-evidence-deletion.test.mjs
44 pass, 0 fail
```

The focused test proves forged client project/checklist/asset input is stripped,
the persisted snapshot uses database values, serial/MAC/IP/location are present,
valid completion succeeds, asset mutation invalidates with an audit event, and
stale/hash/ownership failures block completion.

## Verification

- Changed-file ESLint: pass.
- `bun run build`: pass, including the production TypeScript phase and all 97
  static page generations.
- `dart format --output=none --set-exit-if-changed` for the changed screen: pass.
- `flutter analyze lib`: pass.
- Focused Flutter signature/offline policy tests: 9 pass.
- Migration runner:
  - `0067_service_signature_snapshots.sql`: applied.
  - `0068_service_signature_function_privileges.sql`: applied because privilege
    hardening was identified after 0067 had become immutable.
  - `0069_service_signature_snapshot_lock.sql`: applied because the signing vs
    authoritative-mutation race was identified after 0067/0068 had become
    immutable.
  - second run: zero pending.
- Direct production schema checks:
  - five snapshot/invalidation columns exist;
  - four invalidation triggers exist;
  - 0067/0068/0069 migration records exist;
  - invalidation helper definition contains `FOR UPDATE`;
  - all five new functions deny `PUBLIC` execute.
- `git diff --check`: pass in the mobile repository; scoped web diff check is
  performed before commit.

## Commits

- Mobile: `8f4f35f fix(field-service): stop sending client signature snapshot`
- Web implementation: `67ecd42 feat(field-service): own signed handover snapshots`
- Web report metadata: committed immediately after this update.

## Concern

`bunx tsc --noEmit` is not a clean repository-wide signal in this checkout: it
fails on pre-existing missing `bun:test`/`vitest` declarations and unrelated
test typing errors. Changed-file ESLint, runtime TypeScript compilation through
the focused Bun/PGlite suites, and `flutter analyze lib` are clean.

Migrations 0067, 0068, and 0069 are applied and immutable. The next migration
must be 0070 or later.

## Review fix round 1

Reviewer findings addressed:

1. Attachment cleanup bookkeeping no longer invalidates a newly re-signed
   snapshot. The attachment trigger now reacts only to active-row
   insert/delete, active/tombstone transitions, and columns actually present in
   the snapshot. Lease, attempt, error, and Storage cleanup updates on an
   already tombstoned row are ignored.
2. Snapshot-relevant mutations are rejected once a job is completed. Project,
   job, asset, and evidence direct-DB paths serialize through the same locked
   `service_jobs` row. If mutation wins before completion it invalidates and
   audits normally, so completion rejects the stale signature; if completion
   wins, the later mutation rolls back and the completed signature remains
   valid.

Additional corrections:

- Asset invalidation now compares exactly the business fields persisted in the
  snapshot; technical `updated_at` changes remain allowed.
- Job code and the complete asset ownership/business fields were added to the
  canonical snapshot/invalidation contract.
- Nested Drizzle/Postgres errors are unwrapped and mapped to the safe mobile
  `409 services.errors.signedSnapshotLocked` response, including evidence
  uploads. Manager project/job/asset actions return the same business key
  instead of a generic server error.

TDD evidence:

```text
RED: cleanup bookkeeping for a tombstone must not invalidate a new snapshot
actual invalidated_at was non-null

GREEN:
bun test tests/service-signed-snapshot.test.mjs \
  tests/service-field-operations.test.mjs \
  tests/service-evidence.test.ts \
  tests/service-domain.test.ts \
  tests/service-field-schema.test.mjs \
  tests/service-evidence-deletion.test.mjs
44 pass, 0 fail
```

The new regression covers delete → invalidation → re-sign while cleanup is
pending → cleanup failure/success without invalidation. Direct trigger tests
cover completed project/job/asset/evidence mutation rejection, technical asset
bookkeeping allowance, mutation-before-completion, completion-before-mutation,
rollback state, retained signature validity, and wrapped error mapping.

Verification:

- Changed-file ESLint and scoped `git diff --check`: pass.
- `bun run build`: pass, including production TypeScript.
- `0070_service_signature_terminal_guards.sql`: applied.
- Migration runner second pass: zero pending.
- Direct DB verification confirms the 0070 record, completed-state guard,
  tombstone-state predicate, row-locked helper, and denied `PUBLIC` function
  execution.

Migration 0070 is now applied and immutable. The next migration must be 0071 or
later.
