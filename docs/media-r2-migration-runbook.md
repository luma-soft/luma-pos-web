# LumaPOS media migration to Cloudflare R2

This runbook moves only Luma-owned Supabase media to the managed R2 buckets. External vendor/CDN URLs are inventoried as `skipped` and are never downloaded or rewritten.

## Safety model

- Every package command is dry-run by default.
- A mutating command requires both `--execute` and `--run-id=<uuid>`.
- Inventory execution also requires `--store-id=<uuid>` so one run cannot span tenants.
- Target object keys are immutable and generated from store/domain/migration UUID. They never contain the original file name.
- Copy uses create-only R2 writes and reconciles an existing target by byte size and SHA-256.
- Verify performs R2 `HEAD`, downloads target bytes, and compares SHA-256 before cutover.
- Cutover is a bounded transaction per item. Legacy coordinates remain in the source columns and `media_objects.legacy_*` fields.
- Rollback restores legacy resolution without copying R2 back. It is refused after the source is physically deleted.
- Source deletion is refused until at least 30 days after completed cutover and while any unresolved, quarantined, or fallback-read item exists.

## Prerequisites

1. Apply database migrations through `0118_media_migration_state_machine.sql` using the normal reviewed migration workflow.
2. Configure `DATABASE_URL`, Supabase server credentials, and all `R2_*` variables.
3. Set `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` to the owned Supabase project URL.
4. If a historical bucket is not one of the built-in buckets, add it to `LUMA_LEGACY_MEDIA_BUCKETS` as a comma-separated allowlist. Never add an unverified third-party bucket.
5. Choose one store UUID and one new run UUID. Keep the same run UUID for every stage and rerun.

## 1. Inventory

Read-only preview across the selected environment:

```bash
bun run media:r2:inventory -- --store-id=<store-uuid>
```

Create or resume the run and persist inventory rows:

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts inventory \
  --execute --run-id=<run-uuid> --store-id=<store-uuid>
```

Review `owned`, `skipped`, and per-domain counts. A surprising host or bucket must remain skipped until ownership is confirmed.

## 2. Copy

Preview one bounded batch:

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts copy \
  --dry-run --run-id=<run-uuid> --batch-size=50
```

Execute and rerun until `candidates` becomes zero:

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts copy \
  --execute --run-id=<run-uuid> --batch-size=50
```

Do not continue while items are `failed` or `quarantined`. A rerun reuses the same item and R2 key.

## 3. Verify

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts verify \
  --dry-run --run-id=<run-uuid> --batch-size=50

bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts verify \
  --execute --run-id=<run-uuid> --batch-size=50
```

Verification must finish with no `copied`, `failed`, or `quarantined` items.

## 4. Cutover

Cutover creates the canonical `media_objects` row and links the owning domain in one transaction per item. Legacy product URLs, brand URLs, service bucket/path fields, handover photo URLs, and AI legacy coordinates are retained for rollback.

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts cutover \
  --dry-run --run-id=<run-uuid> --batch-size=25

bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts cutover \
  --execute --run-id=<run-uuid> --batch-size=25
```

After all items are either `cutover` or `skipped`, the run becomes `completed` and receives `completed_at`.

## 5. Rollback

Rollback is available while Supabase source objects still exist:

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts rollback \
  --dry-run --run-id=<run-uuid> --batch-size=25

bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts rollback \
  --execute --run-id=<run-uuid> --batch-size=25
```

Validate web/mobile legacy reads after rollback. Do not run source deletion for a rolled-back run.

## 6. Delete Supabase source objects

Wait at least 30 days after `media_migration_runs.completed_at`. Confirm the run has:

- zero unresolved items;
- zero quarantined items;
- zero recorded fallback reads;
- successful signed/private and public R2 reads in the release gate.

Use an ISO timestamp representing the reviewed confirmation time. It must be at least 30 days after completed cutover and cannot be in the future.

```bash
bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts delete-source \
  --dry-run --run-id=<run-uuid> --batch-size=25

bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts delete-source \
  --execute --run-id=<run-uuid> --batch-size=25 \
  --confirmed-after=<ISO-timestamp>
```

Physical R2 cleanup is not part of this command. Task 11 owns orphan/pending cleanup and reference protection.

## Managed R2 cleanup

`GET /api/cron/media/cleanup` runs hourly at minute 15 and requires
`Authorization: Bearer ${CRON_SECRET}`. Each invocation claims at most 50 rows
with a 15-minute lease, then:

- removes abandoned pending R2 uploads after 24 hours;
- removes soft-deleted, unreferenced R2 originals and thumbnails;
- treats an already missing object as a successful idempotent cleanup;
- records attempt count and the last storage error for retry;
- returns aggregate counts and reclaimed bytes only—never keys, signed URLs,
  file names, store identifiers, or tenant PII.

Reference checks cover active product media, brand logos, service/customer
attachments, handover documents, signatures, migration items, and persisted AI
attachments before a cleanup lease can be claimed. The cleanup claim also moves
expired pending media to `deleted`, so a new active reference cannot race the
physical deletion.

Configure the R2 bucket lifecycle rule to abort incomplete multipart uploads
after seven days. Do not configure a time-based deletion rule for ordinary
objects: application cleanup is authoritative because it verifies references
and retry state first.

## Failure handling

- `failed`: correct the transient storage/database problem and rerun the same stage/run.
- `quarantined`: stop cutover; compare source/target bytes and investigate ownership or corruption.
- `target_conflict`: never overwrite or delete the existing R2 object. Quarantine and inspect the immutable key collision.
- `fallback_reads_present`: keep Supabase data; identify callers still reading legacy coordinates.
- interrupted command: rerun the same command and run UUID. Every item transition is idempotent.

## Production rollout and release gate

Before enabling any production R2 write, run:

```bash
bun run media:r2:preflight
```

This command requires `MEDIA_WRITE_PROVIDER=r2`, validates the six `R2_*`
variables, enforces a public HTTPS origin, and probes both buckets with
`HeadBucket`. Its output is safe aggregate readiness and the
`managed-media-r2-v1` capability only.

Release order is mandatory:

1. schema plus dual-provider reads, with production R2 writes disabled;
2. non-production CORS, signed PUT/GET, custom-domain, bucket and cleanup-cron checks;
3. product-image writes, then 24-hour observation;
4. project/service and related field-media writes, then 48-hour observation;
5. AI writes, then 24-hour observation;
6. bounded inventory/copy/verify/cutover after dry-run review;
7. R2-preferred reads with 30 days of zero Supabase fallback/quarantine;
8. source deletion only after the existing 30-day gate and rollback review.

Record the two successful bucket probes as
`LUMA_R2_PUBLIC_BUCKET_REACHABLE=true` and
`LUMA_R2_PRIVATE_BUCKET_REACHABLE=true` only for the release-preflight run that
uses the same production configuration.

## Audit evidence to retain

- run UUID, store UUID, operator, start/end timestamps;
- dry-run and execute JSON outputs for every stage;
- counts by item status and domain;
- SHA-256/size mismatch investigation notes;
- the exact 30-day deletion confirmation timestamp;
- release-gate output from Task 12.
