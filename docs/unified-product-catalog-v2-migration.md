# Unified Product Catalog V2 migration and rollout

## Database deployment

The production database may already have migration 0142 applied. Do not edit
0142. Apply the new forward-only migration in this order:

1. `0149_catalog_delta_v2.sql` (additive protocol fields/functions/triggers and
   revision floor initialization).
2. Deploy the V2 API and keep the existing V1 route available.
3. Deploy the web client.
4. Ship the iOS client through TestFlight. Debug builds enable V2; Release
   builds require `LUMA_UNIFIED_CATALOG_ENABLED=YES` (or the in-app override)
   to opt into V2. Without it, the shared coordinator uses the paginated
   legacy sync contract.
5. Enable V2 for a controlled cohort after sync, tenant-scope, offline, and
   performance diagnostics are reviewed.
6. Expand rollout and later remove the legacy paginated browse sync after the
   supported old-client window.

This task creates migration files only. Production migration execution is a
separate deployment operation and is not performed by this implementation.
The migration to apply manually is `drizzle/0149_catalog_delta_v2.sql`.

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
