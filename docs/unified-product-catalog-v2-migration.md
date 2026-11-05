# Unified Product Catalog V2 migration and rollout

## Database deployment status

The migration runner applied the pending migrations to the
database configured by `DATABASE_URL`, using its session endpoint and the
runner's reserved connection, PID checks, and advisory lock. The applied files
were:

1. `0144_database_backup_runs.sql`
2. `0147_purchase_order_item_line_order.sql` (fills only missing positions and
   preserves existing document line order)
3. `0148_document_line_order.sql` (fills only missing positions and preserves
   existing document line order)
4. `0149_catalog_delta_v2.sql` (additive protocol fields/functions/triggers
   and revision floor initialization)
5. `0150_catalog_statement_journal.sql` (statement-level, per-store journal
   events for bulk product and document-line changes)

The runner recorded all five files in `_migrations`. A post-run query confirmed
all six V2 journal columns and 24 statement-level triggers (insert, update, and
delete across eight high-volume tables). Existing document line-order values
were preserved. Migration `0142_catalog_delta_journal.sql` was not modified.

## Deployment and rollout order

1. Keep the V1 route available while older mobile clients remain supported.
2. Deploy the V2 API and web client from `main`.
3. The iOS Release build setting now defaults to V2 on `main`. Newly built
   releases use the unified catalog; already installed apps are unchanged.
   The per-device override and `luma.catalog.forceLegacySync` emergency switch
   remain available for rollback.
4. Build and validate a signed TestFlight release without a flag override.
   No TestFlight archive or upload has been made yet.
5. Review sync, tenant-scope, offline, performance, and production metrics
   before expanding distribution. Keep the V1 route and legacy sync available
   through the supported old-client window.

The database migration is complete for the configured database. The iOS source
flag is enabled for future Release builds, but app distribution, signed-client
validation, and production measurement remain separate outstanding steps.

## Existing cache migration

- Web snapshots with an older schema are not assigned to a different tenant or
  role. They remain available only if scope checks pass while the new full
  snapshot is fetched; an incompatible schema is replaced only after a complete
  V2 snapshot commits.
- iOS keeps existing SQLite tables and offline drafts. The migration adds
  catalog persistence tables/columns without clearing drafts or checkout
  metadata. V1 snapshots can be read for rollback but do not satisfy V2 schema
  readiness.
- A tenant/user/effective-role change clears or ignores old catalog scopes
  before publication.

## Rollback

1. Turn off the V2 feature flag for web/iOS clients.
2. Keep the additive V2 journal objects in place; V1 endpoints and storage are
   still available.
3. Clients resume V1 sync and use a complete snapshot if revisions cannot be
   replayed by the legacy journal.
4. Do not drop V2 tables or functions until all V2 clients are disabled and
   retained data has been reviewed. A later cleanup migration may remove them.

No rollback step rewrites business tables or removes cached offline documents.
