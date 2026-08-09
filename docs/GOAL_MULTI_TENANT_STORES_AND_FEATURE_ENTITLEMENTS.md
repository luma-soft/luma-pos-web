# LumaPOS Multi-Tenant Stores and Feature Entitlements — Execution Goal

## 1. Mission

Convert the existing single-store LumaPOS deployment into a production-safe
multi-tenant platform where:

- all existing production data belongs to the current store;
- one store can have many authenticated users;
- one authenticated user belongs to exactly one store;
- login continues to use account credentials only and never asks for a store;
- every authenticated read and mutation is isolated to the user's store;
- the current store keeps every feature it has today;
- other stores can receive a smaller feature set, with current-store-specific
  modules such as camera quotation and branded price lists disabled;
- web, mobile, offline data, public surfaces, integrations, workers, and
  Supabase access enforce the same tenant boundary.

Execute the goal end to end in sequential, independently verified phases. A
phase is complete only after its migration, tests, implementation, and
repository checks pass. Commit and push each completed phase directly to the
currently checked-out `main` branch. Do not create a branch or pull request.

Do not provision or activate a second store until every tenant isolation gate
in this document passes.

## 2. Repositories and sources of truth

Backend, web application, database schema, migrations, and public web surfaces:

```text
luma-pos-web
```

Flutter Android/iOS application, secure session state, SQLite cache, and
offline mutation queue:

```text
luma-pos-mobile
```

The Drizzle schema and tracked migrations are authoritative for the database.
Server-side authorization is authoritative for tenant and feature access. UI
visibility is a projection of server-provided access and is never the security
boundary.

Before changing either repository, read its `AGENTS.md` and preserve unrelated
user changes. In particular, do not stage or modify unrelated failure artifacts
or existing dirty-worktree files.

## 3. Immutable product decisions

### Account and store relationship

For this goal:

```text
one store -> many user accounts
one user account -> exactly one store
```

Implement this with `profiles.store_id`. Do not add store selection to login.
Do not introduce multi-store switching or `store_memberships` in this goal.

If a future product requirement allows one account to manage several stores,
that is a separate migration from `profiles.store_id` to store memberships.

### Login

Users continue to sign in with:

```text
email or phone + password
```

After Supabase authenticates the account, the server resolves `profiles`,
`store_id`, role, active status, store settings, and effective features. The
client must not submit a store ID during login.

Email and internal-login phone identifiers must identify one account globally.
Audit existing phone data before adding a uniqueness constraint. Normalize
phones consistently on profile writes and login reads. Fail closed if legacy
duplicates exist; do not silently attach an account to a guessed store.

### Existing data

Create one deterministic current-store record and attach all existing tenant
data to it. Preserve every current row, relationship, balance, sequence,
configuration value, integration, template, and audit record unless an explicit
schema transformation requires a documented representation change.

Capture pre-migration and post-migration counts for every tenant-owned table.
After backfill, every tenant-owned row must resolve to the current store and no
required `store_id` may remain null.

### Feature ownership

Store features are tenant entitlements, not user-role permissions and not only
frontend flags. A request succeeds only when both conditions hold:

```text
the store has the feature
AND
the user's role permits the operation
```

Deployment environment flags may remain global kill switches. Effective access
is the intersection of the deployment kill switch and the store entitlement.

### Camera quotation versus ordinary quotation

Keep these concepts separate:

- ordinary POS quotations remain a core sales capability;
- the camera quotation builder, camera installation price list, camera material
  helpers, and branded camera public pages are optional current-store features.

Disabling camera quotation must not disable ordinary quotations, bookings,
quotation conversion, quotation printing, or quotation history.

## 4. Required target model

### Stores

Add a canonical `stores` table with at least:

```text
id uuid primary key
slug text unique not null
status active | suspended | archived
created_at timestamptz not null
updated_at timestamptz not null
```

Use immutable UUID identity in relationships. Use slug only for public URLs and
operational lookup. Renaming a store must not change tenant ownership.

### Profiles

Add:

```text
profiles.store_id uuid not null references stores(id)
```

Keep the current role model on the profile because a profile belongs to one
store in this goal. Add a store-leading index for active staff and role queries.

The following invariants must hold:

- every active profile belongs to an active store;
- staff listing and staff mutations are store-scoped;
- a cashier context principal and effective cashier belong to the same store;
- mobile approvals cannot cross stores;
- notification routing never resolves profiles from another store;
- owner/manager mutations cannot target profiles outside their store;
- the last active owner of a store cannot be disabled or demoted accidentally.

### Store settings

Replace the `store_settings.id = 'default'` singleton contract with exactly one
settings record per store, keyed by or uniquely constrained on `store_id`.

All settings accessors must require a store ID, including AI, Zalo, Shopee,
payments, tax/e-invoice, notifications, printing, labels, and onboarding.

Do not select an arbitrary first settings row and do not retain a silent
cross-store fallback to the old `default` row.

### Store features

Add a normalized entitlement table:

```text
store_features
- store_id uuid not null references stores(id) on delete cascade
- feature_key text not null
- enabled boolean not null
- config jsonb not null default '{}'
- updated_by uuid null references profiles(id)
- created_at timestamptz not null
- updated_at timestamptz not null
- primary key (store_id, feature_key)
```

Define a typed, deny-by-default feature registry in application code. Unknown
keys must never become enabled implicitly.

The first registry must distinguish at least:

```text
camera_quote_builder
camera_price_list
hunonic_price_list
rang_dong_price_list
field_services
online_sales
ai_assistant
einvoice
```

Seed all currently available features as enabled for the current store. Define
an explicit core default set for newly provisioned stores. Optional and branded
features default to disabled for new stores.

### Tenant-owned data

Create and maintain a checked-in tenant ownership manifest covering every
application table. Classify each table as:

```text
global
tenant root
tenant child
operational/system
```

All business data is tenant-owned unless the manifest documents why it is truly
global. At minimum, tenant ownership must cover:

- profiles, approvals, audit logs, AI sessions, usage counters, and events;
- categories, brands, price books, products, units, combos, and suppliers;
- warehouses, stock levels, lots, movements, stocktakes, and internal use;
- customers, consent, receivables, suppliers, and payables;
- orders, items, payments, returns, refunds, purchases, and purchase returns;
- shifts, cash transactions, payment accounts, webhooks, and reconciliation;
- projects, service jobs, assignments, visits, evidence, maintenance, assets,
  warranty, dispatch, customer requests, and camera vendor projections;
- promotions, delivery trips, dining tables, kitchen tickets, and modifiers;
- print templates, label templates, marketplace records, Zalo records,
  notifications, devices, outbox rows, telemetry, and sync state.

Prefer an explicit `store_id` on every independently queried or RLS-protected
tenant table. Tenant child tables may derive ownership through a parent only
when the ownership manifest documents the parent path and database constraints
make cross-store parentage impossible.

Use composite foreign keys or equivalent database-enforced constraints where a
child stores both `store_id` and a parent ID. Application-only checks are not
enough for cross-store relationship integrity.

### Tenant-scoped uniqueness

Review every unique constraint and partial unique index. Business identifiers
that are unique within a store must include `store_id`, including examples such
as:

```text
(store_id, sku)
(store_id, customer_code)
(store_id, supplier_code)
(store_id, order_code)
(store_id, purchase_code)
(store_id, return_code)
(store_id, stocktake_code)
(store_id, shift_code)
(store_id, project_or_job_code)
(store_id, template_default_scope)
(store_id, default_warehouse_scope)
(store_id, default_price_book_scope)
(store_id, ai_usage_period)
```

Provider-issued identifiers that are truly global may retain global uniqueness,
but their records still require tenant ownership and authorization.

## 5. Tenant authorization architecture

Create a server-owned context similar to:

```ts
type StoreContext = {
  userId: string;
  storeId: string;
  role: Role;
  features: StoreFeatureSet;
};
```

Provide central gates such as:

```ts
requireStoreContext()
requireStoreRole(roles)
requireStoreFeature(featureKey)
requireStoreFeatureRole(featureKey, roles)
```

Both cookie and bearer-token authentication paths must resolve the same store
context. Cashier switching may change the effective user and role but never the
store.

All tenant data functions must accept `storeId` explicitly. Do not hide tenant
identity in a mutable global. A typical object lookup must constrain both object
and store:

```ts
where(and(
  eq(orders.id, orderId),
  eq(orders.storeId, context.storeId),
))
```

All inserts derive `store_id` from trusted context. Strip or reject a client
provided `storeId`. Updates and deletes must include the same tenant predicate,
including operations performed inside transactions.

For guessed IDs belonging to another store, prefer a non-enumerating `404`
response. A disabled feature may return the shared typed `FEATURE_DISABLED`
error to authenticated clients, while protected page routes should render the
standard not-found experience.

## 6. Staff and account management

One store must support multiple Supabase-authenticated accounts with owner,
manager, cashier, warehouse, and technician roles.

Implement store-scoped staff management and an invitation lifecycle. At minimum
support:

```text
staff_invitations
- id
- store_id
- email and/or normalized phone
- role
- token_hash
- invited_by
- expires_at
- accepted_at
- revoked_at
- created_at
```

Invitation acceptance must bind the authenticated Supabase user to the inviting
store atomically and must not allow the invitee to substitute another store.

Authorization policy:

- owners may manage roles within their store while preserving the last-owner
  invariant;
- managers may manage operational subordinate roles according to the existing
  role policy, but may not grant owner authority or operate across stores;
- inactive or suspended-store users cannot authenticate into application data;
- duplicate/replayed/expired invitation tokens fail safely;
- no auth user may acquire two active profiles in different stores in this
  goal.

Create an operations-only, idempotent provisioning service or script for a new
store and its first owner. A platform-admin UI and public self-service store
signup are non-goals unless already required by an existing documented flow.

Provisioning must create, in one recoverable workflow:

1. the store;
2. per-store settings;
3. the first owner binding/invitation;
4. a default warehouse;
5. default price books;
6. default print/label configuration;
7. the core feature entitlement set;
8. required per-store sync state.

It must not copy products, customers, balances, integrations, secrets, or
branded current-store data into a new store.

## 7. Feature entitlement enforcement

Implement one feature service used by backend, server-rendered UI, APIs, and
mobile payloads. Do not scatter raw JSON checks across components.

For every optional feature, enforce all applicable layers:

1. navigation and action visibility;
2. protected page/layout route;
3. API/server action authorization;
4. data loader and mutation authorization;
5. background job, worker, webhook, and integration behavior;
6. mobile navigation and action visibility;
7. offline enqueue and replay authorization.

Hiding a link without blocking its route or API is incomplete.

### Camera-specific coverage

When `camera_quote_builder` is disabled, the store must not receive:

- camera quote entry points in POS;
- camera package builder state or camera options;
- camera-material management actions;
- the mobile camera quote options API;
- camera-specific offline mutations;
- camera quote navigation in web or mobile.

When `camera_price_list` is disabled, the protected installation price-list
route, data, and navigation must be unavailable.

Gate Hunonic and Rạng Đông branded price-list routes independently using their
own feature keys.

Ordinary POS quotation creation, conversion, cancellation, printing, filtering,
and history must continue to work when camera features are disabled.

### Public camera pages

The existing public `/camera-quote` surface is current-store branded and cannot
remain an unowned singleton page in a multi-tenant model.

Introduce explicit public tenant resolution using a store slug and a route such
as:

```text
/s/{storeSlug}/camera-quote
```

Resolve the store before loading tenant data, verify the public camera feature,
and never infer an arbitrary store. Preserve old links with an explicit legacy
alias or redirect for the current store. The alias must be configured or backed
by a deterministic database mapping, not by selecting the first store.

Public metadata, branding, products, customers, and quotation actions must not
cross tenant boundaries. Do not expose private customer lists on a public
surface.

## 8. Web and mobile session contract

Extend authenticated web/mobile session payloads with safe store context:

```json
{
  "user": {
    "id": "...",
    "email": "...",
    "role": "manager",
    "fullName": "..."
  },
  "store": {
    "id": "...",
    "name": "...",
    "slug": "...",
    "features": {}
  }
}
```

Do not place integration secrets, provider credentials, private prefs, or
server-only feature configuration in the client session.

Refresh must re-resolve active profile, active store, role, and features so
disabled users, suspended stores, role changes, and revoked features take
effect. Do not trust a stale client-carried store ID as authority.

Before authentication, the shared login page should show LumaPOS branding or an
explicit public-store brand resolved by host/slug. After authentication, load
the account's store name automatically. Do not add a store field to the login
form.

## 9. Offline, cache, and realtime isolation

Every persistent or in-memory client cache containing tenant data must include
the store in its scope. Use a stable scope such as:

```text
storeId:userId:effectiveRole
```

Cover at least:

- web IndexedDB product catalog snapshots;
- catalog revision and realtime channels;
- Flutter SQLite product catalog and options;
- dashboard and list caches;
- offline mutation queue and sync metadata;
- POS draft persistence;
- image cache keys where URLs can be reused across stores;
- notification/device state where tenant context matters.

Catalog revision state must be per store rather than one global singleton. A
change in store A must not invalidate or replace store B's catalog.

Logout, account change, token refresh, cashier switch, and app resume must not
display or replay another store's data. An offline mutation must retain the
store captured when it was enqueued, and replay must verify that the current
authenticated store still matches. Never rewrite a queued mutation to the store
of whichever user happens to sign in next.

## 10. RLS, direct Supabase access, and Storage

Replace every tenant-table RLS policy that authorizes authenticated users with
`using (true)` or equivalent broad access.

For direct Supabase/PostgREST reads, policies must verify that `auth.uid()` maps
to an active profile whose `store_id` equals the row's `store_id`. Tenant child
policies must verify ownership through an enforced parent path when the child
does not carry `store_id`.

The web runtime currently uses a database role that can bypass RLS. Therefore:

- server query scoping is mandatory;
- RLS is mandatory for direct client access;
- add defense-in-depth tests for both paths;
- investigate a dedicated non-owner runtime role or transaction-scoped tenant
  setting without weakening or delaying the explicit query predicates.

Storage object paths must begin with a tenant-owned prefix, for example:

```text
stores/{storeId}/products/{productId}/...
stores/{storeId}/services/{jobId}/...
```

Storage policies must validate both authenticated membership and the path's
store segment. Existing public product assets require an explicit compatibility
migration; do not make private service evidence public.

## 11. Integrations, webhooks, workers, and public tokens

Requests without an authenticated user must resolve tenant ownership from a
verified authoritative mapping, such as:

- payment account or merchant credential mapping;
- Shopee marketplace shop mapping;
- Zalo integration mapping;
- signed callback state;
- public portal token mapped to a tenant-owned record;
- outbox/event row already carrying `store_id`.

Never use the current/first/default store as a webhook fallback. Unknown or
ambiguous mappings fail closed and log only safe operational identifiers.

Scope idempotency and deduplication keys by tenant where provider semantics do
not already guarantee global uniqueness. Workers, cron jobs, notification role
routing, maintenance generation, and reconciliation scans must operate per
store and must not send one store's event to another store's users or devices.

## 12. Migration and rollout strategy

Migrations must be additive, idempotent where repository conventions require,
and safe for the existing store. Use the repository migration runner and its
`_migrations` tracking. Do not use `db:push` to apply tracked migrations.

For each tenant-owned table:

1. add nullable `store_id` and supporting indexes/constraints;
2. backfill the deterministic current store;
3. verify row counts, null counts, relationships, and key balances;
4. deploy store-scoped application reads and writes;
5. update uniqueness and cross-store foreign-key constraints;
6. make `store_id` non-null when every writer is tenant-aware;
7. apply and verify RLS/direct-access policy.

Use a compatibility window where necessary, but do not leave dual behavior that
silently falls back to the current store for new writes.

Keep creation/activation of a second store disabled behind an operational gate
until final verification. The existing store must remain usable throughout the
sequence.

## 13. Delivery phases

### Phase 1 — Tenant and entitlement foundation

- Add `stores`, `store_features`, `profiles.store_id`, per-store settings key,
  invitation foundation, and per-store catalog sync state.
- Insert the deterministic current store.
- Backfill all profiles and current settings.
- Seed all current features for the current store.
- Add typed feature registry and pure policy tests.
- Add the tenant ownership manifest and migration audit queries.
- Apply the migration, prove zero pending migrations, query new schema, run
  focused tests, commit, and push the web repository.

This phase must not change the visible behavior of the current store.

### Phase 2 — Authenticated store context and staff safety

- Implement cookie/bearer `StoreContext` resolution.
- Update role gates, mobile auth payload, refresh, cashier context, approvals,
  notification recipients, and staff settings.
- Normalize and audit account phone identifiers.
- Implement same-store staff listing/mutations and invitation acceptance.
- Enforce the last active owner invariant.
- Add two-store auth, staff, cashier, approval, refresh, and invitation tests.
- Commit and push each affected repository after its focused/full checks pass.

### Phase 3 — Core tenant data isolation

- Tenant-scope catalog, inventory, partners, sales, purchases, returns, finance,
  shifts, settings, templates, and reports.
- Update all reads, writes, transactions, counts, filters, searches, previews,
  prints, exports, and direct object routes.
- Convert business uniqueness and default indexes to tenant-scoped forms.
- Add database constraints preventing cross-store product/warehouse/customer/
  supplier/order relationships.
- Add per-domain two-store isolation and same-code-across-store tests.
- Apply and verify every migration, then commit and push.

### Phase 4 — Extended domains and integration isolation

- Tenant-scope projects, services, warranty, maintenance, F&B, delivery,
  promotions, marketplace, payments, e-invoice, AI, notifications, telemetry,
  workers, public tokens, and webhooks.
- Resolve unauthenticated callbacks through verified store mappings.
- Verify recipient routing, outbox recovery, cron processing, provider replay,
  and public-token access across two stores.
- Commit and push after migration and regression verification.

### Phase 5 — Feature entitlements and branded surfaces

- Add central server feature gates.
- Project effective features into web/mobile UI.
- Gate camera builder, camera price list, camera material actions, Hunonic,
  Rạng Đông, field services, online sales, AI, and e-invoice independently.
- Preserve ordinary quotations when camera features are disabled.
- Add slug-scoped public camera routes and an explicit current-store legacy
  redirect/alias.
- Add direct-route, API, action, worker, and offline feature-denial tests.
- Commit and push affected repositories.

### Phase 6 — Client cache, offline, realtime, and Storage isolation

- Scope web IndexedDB, Flutter SQLite, list/dashboard caches, POS drafts,
  realtime channels, catalog revision, and offline queues by store.
- Migrate or invalidate legacy unscoped caches safely.
- Reject cross-store offline replay and stale-session feature access.
- Migrate Storage paths/policies for product and service assets.
- Verify logout/login, account switching, cashier switching, offline restart,
  app resume, and realtime updates with two stores.
- Run Flutter analyze/tests and relevant web checks, then commit and push each
  repository.

### Phase 7 — Provisioning, hardening, and rollout gate

- Implement idempotent operations-only store/first-owner provisioning.
- Seed only core defaults for a new store.
- Make required tenant columns non-null and remove obsolete singleton fallback.
- Replace broad RLS policies and validate PostgREST/direct-client isolation.
- Run complete migration, security, build, regression, and two-store suites.
- Provision a disposable test store, prove isolation, then remove/archive it
  through a documented recoverable test procedure.
- Record final evidence, commit documentation/hardening, and push both repos.

Only after this phase may real additional stores be activated.

## 14. Required verification gates

The goal cannot be declared complete without fresh evidence for all of the
following:

### Migration integrity

- migrations applied using `bun run src/db/apply-migrations.ts`;
- migration runner executed again with zero pending migrations;
- every new table, column, index, unique constraint, foreign key, and policy
  queried successfully;
- pre/post tenant table row counts match expected transformations;
- zero null tenant keys remain where tenant ownership is required;
- current store balances and document relationships remain consistent;
- no unrelated database rows are deleted.

### Tenant isolation

Using store A and store B fixtures:

- store A cannot list, search, count, export, print, preview, read, update,
  delete, approve, convert, refund, assign, or attach to store B records;
- guessed store B UUIDs return non-enumerating errors to store A;
- store A cannot relate a child row to a store B parent;
- store A workers/webhooks/notifications never target store B users/devices;
- direct PostgREST/Supabase reads return only the authenticated store;
- the server-side Drizzle path returns only the authenticated store;
- identical store-scoped SKU, document code, customer code, and defaults can
  coexist in separate stores.

### Authentication and staff

- login requires account credentials only;
- email/phone resolves one global account and then one store;
- a store supports multiple active users and roles;
- staff lists, PIN switching, approvals, invitations, and role changes are
  same-store only;
- disabling a profile or suspending a store takes effect on refresh;
- the last active owner cannot be removed accidentally.

### Feature entitlements

- the current store retains every pre-existing feature;
- a new/default store has optional branded features disabled;
- disabled features disappear from web/mobile navigation;
- direct page, API, server action, worker, and offline access is denied;
- ordinary quotation remains functional without camera features;
- legacy public camera links resolve only the explicit current store;
- no disabled feature data leaks through shared catalog/options responses.

### Cache and offline behavior

- caches and revisions are store-scoped;
- store A updates do not invalidate or overwrite store B data;
- logout/login never flashes another store's cached data;
- queued store A mutations cannot replay as store B;
- cashier switching preserves the same store boundary;
- unscoped legacy cache/mutations are safely invalidated or quarantined.

### Repository quality

- focused domain and authorization tests pass;
- full relevant Bun/TypeScript tests pass;
- ESLint/type checks pass;
- production web build passes;
- Flutter unit/widget tests pass;
- `flutter analyze` passes;
- relevant iOS simulator and Android verification passes for session/cache/UI
  changes;
- repository status contains no accidentally staged unrelated files;
- every completed phase is committed and pushed to `origin/main`.

## 15. Acceptance criteria

The goal is achieved only when:

1. Existing production data belongs to one deterministic current store with no
   loss or cross-store ambiguity.
2. Multiple authenticated users can operate within that store according to
   their roles.
3. Login never requires users to identify their store manually.
4. Every tenant-owned backend read and mutation derives tenant identity from
   authenticated server context.
5. Direct Supabase access, Storage, public tokens, webhooks, workers, realtime,
   caches, and offline replay enforce the same store boundary.
6. Business uniqueness and parent-child integrity are tenant-safe at the
   database layer.
7. Current-store features remain available after migration.
8. New stores receive only the explicit core feature set.
9. Camera quotation and branded price lists can be disabled completely without
   affecting ordinary quotations.
10. Staff management, cashier switching, approvals, and invitations cannot
    cross stores.
11. A newly provisioned test store starts empty, has independent defaults, and
    cannot observe current-store data.
12. All migration, isolation, feature, cache, build, and regression gates pass.
13. All completed work is committed and pushed directly to the existing `main`
    branches without unrelated files.

## 16. Non-goals

- One user switching among multiple stores.
- Organization/group hierarchy above stores.
- Shared catalog, shared inventory, or shared customers across stores.
- Cross-store consolidated reporting.
- Public self-service merchant signup or billing/subscription checkout.
- Replacing Supabase Auth.
- Rewriting established order, inventory, debt, payment, return, or service
  accounting semantics.
- Removing ordinary quotations from stores that lack camera features.
- Copying current-store products, customers, balances, integrations, secrets,
  or branded content into newly provisioned stores.

## 17. Execution, commits, and reporting

Work sequentially on the currently checked-out `main` branch. Do not create a
new branch or pull request.

For every phase:

1. inspect both repository statuses and identify unrelated changes;
2. add failing focused tests for the phase's security/behavior contract;
3. implement the smallest complete phase without enabling a second real store;
4. apply and verify migrations when schema changes;
5. run focused tests, relevant regression tests, lint/analyze, and builds;
6. inspect the final diff and stage only files belonging to the phase;
7. commit with a descriptive message;
8. push directly to the configured `origin/main`;
9. report commit hash, pushed repository, migrations applied, tests run, and
   remaining phases.

Before asking for GitHub authentication, test the configured remote directly
with `git ls-remote origin HEAD`. Use the repository's existing HTTPS remote and
credential. A failed `gh auth status` alone is not evidence that `git push` is
unauthenticated.

Do not combine unrelated user changes with tenant work. Do not delete or reset
dirty-worktree files. If an existing change overlaps a required file, preserve
it and integrate carefully; stop only when the overlap cannot be resolved
safely.

Continue through all phases autonomously while safe in-scope work remains. A
missing external credential, production approval, or physical environment may
be documented as an external verification blocker, but it does not justify
skipping implementable tenant isolation, automated tests, migrations, or local
verification.
