# ADR-0001: Local PostgreSQL with device-first offline and Supabase relay

- **Status:** Accepted direction; implementation in progress
- **Date:** 2026-11-12
- **Decision owners:** LumaPOS product owner

## Context

LumaPOS is moving to offline-first operation across web, two iPhones and a future macOS client. PostgreSQL will run on the store's macOS host now and may move to a VPS later. Devices must exchange changes over the Internet even when they cannot reach that Mac directly.

The web client currently uses a remote PostgreSQL database through the Next.js server on Vercel. Web IndexedDB and native SQLite contain useful product snapshots, drafts, query caches and limited mutation queues, but most business reads and writes still depend on the server. Supabase currently also provides Auth, Realtime and some media storage.

## Decision

1. The PostgreSQL database on the macOS host is authoritative for **accepted** business records. Moving the database to a VPS later must preserve the PostgreSQL schema and application behavior.
2. Each client reads from durable local data first. Web uses IndexedDB; iPhone and the future macOS client use SQLite.
3. Every offline mutation is saved locally with a stable identity and is visibly pending. Orders, payments, debt and inventory changes become official only after the macOS-hosted application process validates and commits them in a PostgreSQL transaction.
4. Supabase is used as the cloud sync relay for store-scoped change envelopes, device checkpoints and sync notifications. It does not own authoritative business tables or run ordinary business reads and writes. Supabase identity may authorize access to this sync relay only.
5. Only the macOS-hosted application process writes to local PostgreSQL. Web and mobile clients never receive database credentials or connect to PostgreSQL directly.
6. Devices outside the store network can submit and receive pending changes through the relay. When the macOS host reconnects, it processes those commands using the existing business rules and publishes canonical acceptance or a conflict.
7. Stock, pricing and financial conflicts use explicit domain rules. Last-write-wins is not an acceptable resolution policy for these records.
8. The future macOS app uses the same local data and synchronization rules as the iPhone and web clients.

## Consequences

- The authenticated Next.js business runtime cannot remain on Vercel while directly reading the private macOS PostgreSQL database. The web runtime must move beside the database, or authenticated business reads must move fully to the local-first client and sync relay.
- Supabase-specific Auth, Realtime, Storage and SQL dependencies must be isolated or replaced. Existing PostgreSQL migrations are not yet a plain-PostgreSQL bootstrap because they reference Supabase schemas and roles.
- Device-local state needs explicit pending, accepted and conflict states, scoped by store, user and device. Existing POS order idempotency and native mutation recovery provide starting points, not a complete cross-feature sync model.
- The relay may contain pending business change payloads. Access must remain store-scoped and authenticated; a client must never write directly to the local PostgreSQL host.
- Existing Supabase business data has not been copied or cut over. Data export, local import, reconciliation and rollback require a separate controlled migration step.
- The relay is disabled behind `LUMAPOS_SYNC_RELAY_ENABLED` until snapshot reconciliation, Mac worker readiness and client rollout are complete. Enabling the POS slice alone does not cut over other business writes or read models.
- The POS client slice now writes eligible cash/credit orders to a durable device outbox before network submission. Web confirms the IndexedDB transaction committed; iPhone persists both the SQLite outbox entry and queued invoice state before sending. Retries reuse the same client ID. Gateway payments, discounts, manual prices, source-derived edits and returns still require their supported online flows.
- This protects a POS order across a dropped response or app interruption; it does not finish the authority cutover. The existing web order action remains in place while the relay and Mac processor are staged, and queued orders remain pending until the configured synchronization path accepts them.

## Rollout

1. Bootstrap the local PostgreSQL schema and remove Supabase-only database assumptions from the local runtime.
2. Run the business application process beside PostgreSQL and establish the sync relay and durable command-processing rules.
3. Migrate a vertical slice from Product Catalog through POS order creation, including offline pending state and canonical conflict handling.
4. Expand local-first reads and queued writes through inventory, purchasing, customers, services and finance, retaining domain validation.
5. Add the macOS client after shared persistence and sync behavior is stable on web and iPhone.

## Local host state

PostgreSQL 17 is installed through Homebrew and runs on loopback at `127.0.0.1:5432`. The `lumapos_local` database contains the current schema, applied with local compatibility objects for legacy Supabase SQL, plus one data snapshot imported from the configured database. The source database was not modified. The app runtime has not been switched to this database, and no Supabase credentials were copied into PostgreSQL.
