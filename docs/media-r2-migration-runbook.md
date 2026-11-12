# LumaPOS media migration to Cloudflare R2 and local storage

This runbook moves only Luma-owned Supabase media to the managed R2 buckets. External vendor/CDN URLs are inventoried as `skipped` and are never downloaded or rewritten.

## Mac local filesystem migration

The self-hosted target uses the same inventory/copy/verify/cutover state machine,
with R2 or Supabase as the source and the Mac filesystem as the target. Managed
`media_objects` keep their IDs and domain links; both original and thumbnail bytes
are copied and SHA-256 checked before their provider and keys change in one DB
transaction. This is the path for `lumapos_rehearsal`; the legacy commands below
remain for the earlier Supabase-to-R2 migration.

The local target is deliberately restricted to a named local database. Every
stage must include `--local-database --target-provider=local` and use the same
`LUMAPOS_LOCAL_DATABASE_NAME`. The script rejects `target-provider=local` when it
would use `DATABASE_URL`, and rejects `--local-database` with an R2 target.

Apply the schema to the rehearsal database only:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal bun run db:migrate:local
```

Inventory one store per run because migration-run ownership is tenant-scoped.
Review all `skipped` references and the host/bucket allowlist before copying.
The read-only dry-run reports `externalHosts` as hostname-only counts, without
printing complete URLs, paths, query strings, or signed tokens:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal \
  bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts inventory \
  --local-database --target-provider=local --dry-run --store-id=<store-uuid>
```

Then persist an inventory using a new run UUID for each store and keep that UUID
for every later stage:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal \
  bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts inventory \
  --local-database --target-provider=local --execute \
  --run-id=<run-uuid> --store-id=<store-uuid>
```

Copy and verify bounded batches with the same database name and run UUID:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal \
  bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts copy \
  --local-database --target-provider=local --execute \
  --run-id=<run-uuid> --batch-size=25

LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal \
  bun --conditions=react-server run src/scripts/migrate-media-to-r2.ts verify \
  --local-database --target-provider=local --execute \
  --run-id=<run-uuid> --batch-size=25
```

The copy stage requires server-only R2 source credentials and
`MEDIA_LOCAL_ROOT`, `MEDIA_LOCAL_SIGNING_SECRET`, and `LUMAPOS_PUBLIC_URL`. The
Mac media root should be a durable path such as `/Users/Shared/LumaPOS/media`,
outside the repository. The public origin must be the stable HTTPS host selected
for the store; do not expose filesystem paths or signing secrets. A verified
copy is not yet a cutover. Run the `cutover` stage only after the local Next.js
runtime, file routes, backup/restore, and HTTPS origin have passed rehearsal.
Keep R2 source objects during the rollback window; do not run `delete-source`
for the local migration until the product owner approves its retention gate.

**Current gate (2026-11-13):** a read-only rehearsal dry-run (`writes: 0`)
discovered 2,476 references: 454 owned and 2,022 classified as `external_url`
because their hosts are outside the current Supabase allowlist. The hostname-only
breakdown is:

| Hostname | References |
| --- | ---: |
| `cdn2-retail-images.kiotviet.vn` | 1,657 |
| `cdn-images.kiotviet.vn` | 335 |
| `cdn1-retail-images.kiotviet.vn` | 8 |
| `eo-sgp-cos.ruijie.com` | 9 |
| `tuyetlights.com` | 3 |
| `encrypted-tbn2.gstatic.com` | 2 |
| `product.hstatic.net` | 1 |
| `lssth.panasonic.com` | 1 |
| `vph.com.vn` | 1 |
| `materialfile.dahuasecurity.com` | 1 |
| `encrypted-tbn0.gstatic.com` | 1 |
| `rapidtech.co.ke` | 1 |
| `hungvuongcoltd.com` | 1 |
| `www.nhatthuc.com.vn` | 1 |

Counts help triage only; they do not establish ownership, license, or permission
to copy. Confirm each source before changing the allowlist. The R2 readiness
target-write check (`media:r2:preflight`) previously reported `ready: false`.
That check requires the application to be configured to write to R2 and does not
prove whether existing R2 objects can be read as a migration source. The
self-hosted local target uses a separate, read-only source check. It requires an
explicit rehearsal database name, reads one representative ready object from
each visibility class present, and outputs only capability booleans:

```bash
LUMAPOS_LOCAL_DATABASE_NAME=lumapos_rehearsal bun run media:r2:source-preflight
```

This check performs PostgreSQL `SELECT` queries and R2 `HEAD` requests only; it
does not write database or object data and does not require
`R2_PUBLIC_BASE_URL`. A `ready: true` result confirms the sampled source reads,
not every object. The migration copy/verify stages still need to pass for all
objects before cutover.

**Source-read probe (2026-11-13):** the rehearsal database was reachable and
contained ready source objects in both visibility classes. The R2 source
credential configuration was absent, so public/private reads were not attempted
(`null`). This probe copied no files and changed no provider. Configure the
server-side `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` for
the migration process, then rerun the check before copying. Do not cut over
until the source-read check, all-object checksum verification, local file
serving/backup rehearsal, and external-domain review are complete.

## Current production status

As confirmed by the user on 2026-11-04, all LumaPOS-managed media has been
migrated to R2. This records migration/cutover completion; it does not confirm
that retained Supabase source copies have been physically deleted. Use the
source-deletion procedure below only for any remaining copies and keep its
retention and rollback gates.

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
