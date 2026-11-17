# Successful mutation data synchronization

## Contract

- Publish/invalidate only after the server transaction commits. Validation errors,
  failed requests and queued offline writes are not confirmed saves.
- Server actions use `revalidateAppData` from `src/lib/sync/revalidate-app-data.ts`.
  It preserves the specific path invalidation and refreshes the authenticated
  layout so dependent lists, details and modal routes receive fresh projections.
- The layout passes a server render token through `AppDataSyncProvider` and the
  database catalog revision through `ProductCatalogProvider`.
- Retained client read models use `useAppDataQuery`; selected records should be
  resolved by ID against fresh rows. Do not reset unsaved forms or POS drafts.
- Client API mutations must check success and refresh the router as well as their
  local read model. Router refresh alone does not replace arbitrary `useState`.
- A post-write refresh must not reuse an earlier in-flight read. Use the refresh
  queue and tenant/actor scope checks; never publish an older catalog revision.

## Product stock editing

`updateProduct` and `PATCH /api/mobile/products/:id` accept an optional
`stockAdjustment: { quantity, expectedQuantity }`. Send it only when stock changed,
using the quantity captured when the editor opened as the expected value.

Current stock permits negative numbers and four decimal places. Opening stock is
separate and nonnegative; copying products never copies existing inventory.
Adjustment requires manager access and atomically updates the stock balance and
adjustment history with the product. Conflicts reject the write instead of
overwriting stock changed by another transaction.

An aggregate product form cannot select a warehouse, lot or variant. Multiwarehouse,
lot-tracked and variant-parent balances therefore require the stocktaking workflow.
Services and combos cannot receive direct physical-stock adjustments.

## Regression checks

Run `bun test tests/product-form-values.test.ts tests/product-stock-adjustment.test.ts
tests/refresh-queue.test.ts tests/app-data-revalidation.test.ts
tests/tenant-product-catalog-revision.test.mjs`.

Stock persistence tests use an isolated in-memory database, not store inventory.
For new CRUD surfaces, verify create/update/delete from the originating screen and
an already-mounted detail/list, plus failure, read-after-write races and tenant
switches. Session-specific histories and nested sheets need explicit review;
central invalidation does not automatically rewrite their local state.

## Web offline sync switch (per browser)

Settings › POS › "Đồng bộ offline / Offline sync" is a per-browser switch stored in
`localStorage` (`luma.web.offline-sync.enabled.v1`, see
`src/lib/offline/offline-sync-preference.ts`). Default: **off**.

- Off: POS orders call the `createOrder` server action directly (no IndexedDB
  outbox write-ahead, no sync relay, no queueing on network failure — the cart
  stays and an error is shown). Service checklist edits call
  `updateServiceChecklist` directly. Product Catalog and stock history are not
  read from or written to IndexedDB; turning the switch off clears both caches.
  Orders/checklists queued earlier while it was on are still drained.
- On: the existing offline-first path (IndexedDB outbox + `/api/sync/relay`,
  persisted catalog and stock history).
- The service worker is unchanged (static assets + public offline page only).
