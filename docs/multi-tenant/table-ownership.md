# Multi-Tenant Table Ownership Manifest

The executable manifest is
[`src/lib/tenancy/table-ownership.ts`](../../src/lib/tenancy/table-ownership.ts).
An automated test compares it with every `pgTable` declaration in
`src/db/schema.ts`, so adding a table without an explicit ownership decision
fails the test suite.

The classifications mean:

- `global`: platform identity shared only for routing or control-plane use;
- `tenant-root`: independently queried business aggregate that must carry
  `store_id`;
- `tenant-child`: ownership inherited through a tenant parent, with explicit
  `store_id` added when needed for RLS, independent queries, or integrity;
- `operational/system`: tenant-owned audit, cache, delivery, telemetry, worker,
  or integration state that must never be treated as globally visible.

`stores` is the only currently global application table. Global means the
platform can address it; it does not grant ordinary store users permission to
list other stores.

Tenant columns and constraints are introduced in the execution goal's ordered
migrations. A table's presence in this manifest does not by itself mean that a
particular phase has completed its physical tenant migration.
