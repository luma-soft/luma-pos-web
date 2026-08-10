# Multi-tenant rollout gate

Additional production stores may be activated only after the migration and
verification gates in this document pass.

## Operations commands

Provisioning is operations-only and idempotent. It creates one store, one
first owner, store settings, one default warehouse, retail/cost price books,
six default print templates, a catalog revision row, and disabled rows for all
optional features. It never copies products, customers, balances, integrations,
or secrets from another store.

```sh
LUMA_OWNER_PASSWORD='...' bun run ops:provision-store -- \
  --slug <store-slug> --name '<store name>' \
  --owner-email <owner@example.com> --owner-name '<owner name>'
```

Disposable verification stores must use a `codex-isolation-*` slug. Cleanup is
recoverable: it archives the store, deactivates its profiles, and bans its auth
owner. Restore reverses those operations.

```sh
bun run ops:archive-store -- --slug codex-isolation-YYYYMMDD
bun run ops:archive-store -- --slug codex-isolation-YYYYMMDD --restore
```

## 2026-08-10 rollout evidence

- Applied migrations `0104`, `0105`, and `0106`; rerun reported zero pending.
- All public tenant tables have non-null `store_id`, no `store_id` default, and
  RLS enabled.
- No exact `USING (true)` or `WITH CHECK (true)` policy remains.
- Storage writes require `stores/{storeId}/...` plus an active membership.
- Disposable store `a170d343-af06-4e68-bb19-c1b8969cffb9` provisioned with one
  owner, zero products, zero customers, and zero enabled optional features.
- Authenticated direct-client counts for that store were zero for `products`,
  `customers`, and `orders`, while the current store retained 3,313 products
  and 97 customers.
- A second provisioning run returned the same store and owner with no duplicate
  defaults.
- The disposable store was archived and its only profile deactivated; it can be
  restored with the command above.
- Production web build, focused tenancy/feature/cache tests, Flutter analyze,
  and focused Flutter cache/offline tests passed.

The broad repository test command still contains pre-existing environment and
UI-contract failures: PGlite lacks `pg_trgm`/Supabase `auth`, PostgreSQL-only
tests expect a local server at `127.0.0.1:5432`, and unrelated responsive/search
snapshot tests are stale. Tenant-focused gates and the production database
checks above pass independently of those fixtures.
