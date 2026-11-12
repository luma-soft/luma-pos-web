# ADR-0002: Self-hosted PostgreSQL and Next.js backend

- **Status:** Accepted
- **Date:** 2026-11-12
- **Decision owners:** LumaPOS product owner
- **Supersedes:** [ADR-0001](0001-offline-first-local-postgres.md)

## Context

The current runtime uses Vercel and Supabase for PostgreSQL, Auth, selected Realtime and Storage paths, and a sync relay. Local PostgreSQL setup, migration, and data-import scripts exist in the web repository, but their presence does not establish the live state of the local database. The product decision is to operate the backend at the store first and move it to a VPS later without changing its schema or business behavior.

## Decisions

1. PostgreSQL is the single authoritative store for accepted business records. It runs on the store's Mac initially and may move to a VPS later.
2. Next.js runs beside PostgreSQL and is the only business API/backend for web and iPhone. Clients never receive database credentials and never connect directly to PostgreSQL.
3. Supabase Cloud and Supabase self-host are not part of the target architecture. Supabase Auth, relay, Realtime, Storage, scheduled work, and deploy dependencies are replaced as each slice migrates.
4. Web IndexedDB and iPhone SQLite remain durable offline stores. Mutations have stable client/device identities and explicit `pending`, `accepted`, or `conflict` outcomes. PostgreSQL applies accepted mutations transactionally through existing domain rules; stock, price, and financial records are never resolved with last-write-wins.
5. Authentication and authorization are owned by LumaPOS. Sessions are scoped to account, store, role, and device; revocation is enforced by the backend.
6. pgAdmin 4 Desktop is the selected database operator tool on the store Mac. Database access is restricted to administrators with separate DB credentials. Ordinary LumaPOS users use application administration pages and receive no SQL access.
7. Uploaded files use a storage adapter and stable object keys. The store Mac uses a local filesystem provider first; a VPS migration can switch to a compatible remote provider without embedding machine-specific paths in business records.
8. Background jobs run as supervised backend workers or protected backend tasks with durable scheduling/locking. Vercel Cron and external Supabase relay processing are not target dependencies.
9. Cutover uses a final write freeze, final export/import, reconciliation, and a single authority switch. No prolonged dual-write is allowed. Supabase Cloud can be retired only after reconciliation, rollback-window approval, and removal of all runtime dependencies.

## Consequences

- Every browser, mobile, webhook, payment, scheduled-job, and storage path that directly relies on Supabase must be inventoried and migrated or deliberately retired.
- The Mac host must provide HTTPS reachability for remote iPhone use, supervised Next.js and worker processes, protected secrets, backup monitoring, and documented recovery procedures.
- The VPS move must preserve application configuration contracts, PostgreSQL schema, object keys, and backend API behavior. Only host-specific infrastructure values such as database endpoint, public HTTPS origin, file provider, and process supervisor should change.
- pgAdmin is an operator tool, not the LumaPOS product admin UI. User/role management, backup status, backend health, and background-job status belong in authenticated, audited LumaPOS administration pages.

## Rollout outline

1. Inventory current Supabase coupling, confirm the actual local PostgreSQL state separately, and establish a self-hosted runtime, health checks, secrets handling, migration discipline, backup/restore, and file-storage boundary.
2. Replace Auth and tenant authorization with LumaPOS-owned accounts, stores, roles, browser sessions, mobile tokens, and revocation.
3. Replace the sync relay with a transactional command inbox and receipt/conflict protocol; migrate one vertical slice at a time while local persistence remains durable.
4. Move media and background tasks behind host-independent adapters and supervised jobs; migrate webhook and scheduled-work routes.
5. Run data rehearsal and reconciliation, freeze writes, import the final snapshot, switch one authoritative runtime, and keep a tested rollback path during the agreed window.
6. Remove Supabase runtime code, secrets, cron, and services only after production verification and rollback-window sign-off.

## Open decisions

- **Remote iPhone connectivity:** choose a stable public HTTPS endpoint, a VPN-only endpoint, or a managed outbound tunnel in front of the store Mac. A public endpoint is easiest for phones but requires hardening and uptime planning; VPN limits exposure but requires enrollment and may complicate support; a managed tunnel avoids inbound router ports but adds a vendor dependency. The default recommendation is a stable HTTPS hostname with a managed tunnel or reverse proxy and strict application authentication, with VPN as a store-owner preference.
- **Authentication lifecycle:** choose the initial account-invitation and password-reset workflow, recovery administrator, and token/session lifetime policy before implementation.
- **File provider on VPS:** choose object storage provider and retention policy before moving beyond the local Mac provider.
- **Final cutover window and rollback duration:** set after rehearsal duration and acceptable offline queue drain time are known.

## State verification note

The repository documents local PostgreSQL setup and an imported snapshot. This decision record does not claim the database currently exists, is running, contains that snapshot, or is ready for application runtime. Verify its state in a separately authorized operational step before planning a cutover.
