# Internal Mobile Push Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver durable internal mobile push notifications for completed invoices, received purchases, standalone debt changes, QR payment confirmation, and QR reconciliation exceptions, with healthy-provider QR delivery accepted by FCM at p95 below five seconds.

**Architecture:** Persist an immutable notification event, materialized recipients, and a provider-neutral outbox in the same PostgreSQL transaction as each business mutation. Publish a versioned identifier-only envelope through a queue adapter, initially QStash, then process it in an idempotent worker that reuses the existing FCM/device-delivery foundation; Flutter resolves the authorized event and navigates to the exact entity.

**Tech Stack:** Next.js 16.2 route handlers, TypeScript 5, Bun test, Drizzle ORM 0.45/PostgreSQL, `@upstash/qstash`, Firebase Cloud Messaging HTTP v1, Flutter/Dart, Riverpod, `firebase_messaging`.

**Approved design:** `docs/superpowers/specs/2026-07-28-internal-mobile-push-events-design.md`

## Global Constraints

- Internal staff only; do not add customer or supplier delivery channels.
- QStash is the initial adapter, not a business-layer dependency.
- Queue envelopes contain only `version`, `eventId`, `deduplicationKey`, and `queuedAt`.
- No network call may occur inside a business database transaction.
- The transactional outbox invariant is mandatory: event, recipients, and outbox commit or roll back atomically with the business mutation.
- A transaction emits at most one primary event: QR confirmation/exception before invoice/purchase before standalone debt change.
- QR categories bypass quiet hours; routine categories defer and remain recoverable.
- Lock-screen content must not include partner identity, phone, address, amount, debt balance, bank information, reference, or note.
- FCM/APNs operating-system display time is best effort; the measured SLA ends at successful FCM acceptance.
- Keep existing shared-terminal principal/effective-user checks.
- Apply every migration with `bun run src/db/apply-migrations.ts`, verify `_migrations`, and query the new schema before completion.
- Preserve unrelated work in both repositories.
- Use TDD for every behavior change.

---

## File and interface map

### New backend units

- `src/lib/notifications/contracts.ts` — provider-neutral categories, event input, queue envelope, publisher/verifier, sender result.
- `src/lib/notifications/events-core.ts` — transaction-bound event/recipient/outbox creation and deterministic keys.
- `src/lib/notifications/outbox-core.ts` — provider-neutral publish claims, worker leases, retry/dead transitions.
- `src/lib/notifications/queue/config.ts` — environment validation and runtime adapter resolution.
- `src/lib/notifications/queue/qstash.ts` — only module allowed to import `@upstash/qstash`.
- `src/lib/notifications/outbox.ts` — production DB wrappers for publish/recovery/process use cases.
- `src/lib/notifications/fcm-message.ts` — localized, privacy-safe FCM request construction and FCM error classification.
- `src/lib/notifications/mobile-events.ts` — authenticated list/resolution projections for persisted events.
- `src/app/api/workers/notifications/push/route.ts` — QStash-authenticated worker entry point.
- `src/app/api/cron/notifications/outbox/route.ts` — protected recovery publisher.
- `tests/notification-event-service.test.mjs` — PGlite atomicity, routing, and idempotency.
- `tests/notification-queue-contract.test.ts` — fake/QStash configuration and envelope contracts.
- `tests/notification-outbox-worker.test.mjs` — leases, delivery dedupe, quiet-hour deferral, retry/dead behavior.

### Existing backend units to extend

- `src/db/schema.ts`
- `drizzle/0064_internal_notification_outbox.sql`
- `src/lib/schemas/settings.ts`
- `src/lib/notifications/push.ts`
- `src/lib/orders/create.ts`
- `src/lib/orders/convert.ts`
- `src/lib/orders/cancel.ts`
- `src/lib/orders/payment-core.ts`
- `src/lib/orders/payment.ts`
- `src/lib/actions/marketplace.ts`
- `src/lib/actions/purchases.ts`
- `src/lib/actions/purchase-returns.ts`
- `src/lib/actions/returns.ts`
- `src/lib/payments/service-core.ts`
- `src/lib/payments/service.ts`
- `src/app/api/payments/sepay/webhook/route.ts`
- `src/app/api/mobile/notifications/route.ts`
- `src/app/api/mobile/notifications/[id]/route.ts`
- `src/app/api/mobile/notifications/settings/route.ts`
- `src/app/(app)/settings/settings-client.tsx`
- `.env.example`
- `tests/notification-settings.test.ts`
- `tests/push-notification-policy.test.ts`
- `tests/sepay-payment-service.test.mjs`
- `tests/manual-payment-idempotency.test.mjs`

### Mobile units to extend

- `../luma-pos-mobile/lib/src/core/notifications/push_notification_service.dart`
- `../luma-pos-mobile/lib/src/core/api/mobile_endpoints.dart`
- `../luma-pos-mobile/lib/src/core/api/mobile_data_repository.dart`
- `../luma-pos-mobile/lib/src/core/widgets/app_shell.dart`
- `../luma-pos-mobile/lib/src/features/more/presentation/invoices_screen.dart`
- `../luma-pos-mobile/lib/src/features/inventory/presentation/inventory_screen.dart`
- `../luma-pos-mobile/lib/src/features/customers/presentation/customers_screen.dart`
- `../luma-pos-mobile/lib/src/features/more/presentation/suppliers_screen.dart`
- `../luma-pos-mobile/lib/src/features/more/presentation/payment_reconciliation_screen.dart`
- `../luma-pos-mobile/lib/src/features/more/presentation/notifications_screen.dart`
- `../luma-pos-mobile/test/core/notifications/push_notification_service_test.dart`
- `../luma-pos-mobile/test/widget_test.dart`

---

### Task 1: Persist neutral notification contracts and settings

**Files:**
- Create: `drizzle/0064_internal_notification_outbox.sql`
- Modify: `src/db/schema.ts`
- Create: `src/lib/notifications/contracts.ts`
- Modify: `src/lib/schemas/settings.ts`
- Modify: `tests/notification-settings.test.ts`
- Create: `tests/notification-schema.test.mjs`

**Interfaces:**
- Produces: `NotificationCategory`, `NotificationTarget`, `NotificationQueueMessageV1`, `NotificationQueuePublisher`, `NotificationQueueRequestVerifier`, and three Drizzle tables.
- Consumes: existing `profiles`, `mobilePushDeliveries`, `StorePrefs`, and role enum.

- [ ] **Step 1: Write failing settings-contract tests**

Extend `tests/notification-settings.test.ts`:

```ts
test("defaults internal event categories and role routing", () => {
  const notifications = parseStorePrefs({}).notifications;
  expect({
    invoiceCreated: notifications.invoiceCreated,
    purchaseReceived: notifications.purchaseReceived,
    debtChanged: notifications.debtChanged,
    qrPaymentConfirmed: notifications.qrPaymentConfirmed,
    qrPaymentException: notifications.qrPaymentException,
  }).toEqual({
    invoiceCreated: true,
    purchaseReceived: true,
    debtChanged: true,
    qrPaymentConfirmed: true,
    qrPaymentException: true,
  });
  expect(notifications.roleRouting.invoiceCreated).toEqual(["owner", "manager"]);
  expect(notifications.roleRouting.purchaseReceived)
    .toEqual(["owner", "manager", "warehouse"]);
  expect(notifications.roleRouting.debtChanged).toEqual(["owner", "manager"]);
  expect(notifications.roleRouting.qrPaymentConfirmed).toEqual(["owner", "manager"]);
  expect(notifications.roleRouting.qrPaymentException).toEqual(["owner", "manager"]);
});
```

- [ ] **Step 2: Write the failing migration/schema smoke test**

Create `tests/notification-schema.test.mjs` using the migration loop from `tests/sepay-payment-service.test.mjs`, then assert:

```js
const eventColumns = await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'notification_events'
`);
ok("event schema exists", [
  "id", "event_key", "category", "entity_type", "entity_id", "actor_id",
  "target", "priority", "quiet_hours_policy", "metadata",
  "occurred_at", "created_at",
].every((name) => eventColumns.rows.some((row) => row.column_name === name)));

const outboxColumns = await client.query(`
  select column_name
  from information_schema.columns
  where table_name = 'notification_outbox'
`);
ok("outbox is provider neutral", [
  "event_id", "status", "provider", "provider_message_id", "attempt_count",
  "available_at", "lease_expires_at", "last_error_code",
  "published_at", "first_attempt_at", "completed_at",
].every((name) => outboxColumns.rows.some((row) => row.column_name === name)));
```

- [ ] **Step 3: Run both tests and confirm they fail**

Run:

```bash
bun test tests/notification-settings.test.ts
bun tests/notification-schema.test.mjs
```

Expected: settings keys are absent and migration tables do not exist.

- [ ] **Step 4: Add the provider-neutral TypeScript contracts**

Create `src/lib/notifications/contracts.ts`:

```ts
export const notificationCategories = [
  "invoiceCreated",
  "purchaseReceived",
  "debtChanged",
  "qrPaymentConfirmed",
  "qrPaymentException",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];

export const notificationTargets = [
  "invoices",
  "purchases",
  "debt",
  "paymentReconciliation",
] as const;

export type NotificationTarget = (typeof notificationTargets)[number];
export type NotificationPriority = "normal" | "high";
export type QuietHoursPolicy = "defer" | "bypass";

export type NotificationQueueMessageV1 = {
  version: 1;
  eventId: string;
  deduplicationKey: string;
  queuedAt: string;
};

export interface NotificationQueuePublisher {
  publish(
    message: NotificationQueueMessageV1,
  ): Promise<{ providerMessageId: string }>;
}

export interface NotificationQueueRequestVerifier {
  verify(request: Request): Promise<NotificationQueueMessageV1>;
}

export class NotificationQueueVerificationError extends Error {
  constructor(
    readonly reason: "invalid_signature" | "invalid_message",
  ) {
    super(reason);
  }
}
```

- [ ] **Step 5: Add Drizzle tables and migration**

Add `notificationEvents`, `notificationRecipients`, and `notificationOutbox` to `src/db/schema.ts`. Use text/varchar status/category columns rather than PostgreSQL enums so a future category does not require enum replacement.

The migration must create:

```sql
CREATE TABLE "notification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_key" varchar(200) NOT NULL UNIQUE,
  "category" varchar(40) NOT NULL,
  "entity_type" varchar(40) NOT NULL,
  "entity_id" uuid NOT NULL,
  "actor_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "target" varchar(40) NOT NULL,
  "priority" varchar(16) NOT NULL,
  "quiet_hours_policy" varchar(16) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "notification_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL REFERENCES "notification_events"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "reason" varchar(16) NOT NULL,
  "read_at" timestamptz,
  "dismissed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL UNIQUE REFERENCES "notification_events"("id") ON DELETE CASCADE,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "provider" varchar(32),
  "provider_message_id" varchar(180),
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "lease_expires_at" timestamptz,
  "last_error_code" varchar(80),
  "published_at" timestamptz,
  "first_attempt_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
```

Add unique `(event_id, user_id)` and indexes for `(user_id, created_at)`, `(status, available_at)`, and `(category, created_at)`.

- [ ] **Step 6: Extend notification settings**

Add the five booleans and five role arrays to `notificationPrefs` and the `storePrefsSchema` defaults. Preserve legacy JSON upgrade behavior by providing defaults for every new key.

- [ ] **Step 7: Run focused tests**

Run:

```bash
bun test tests/notification-settings.test.ts
bun tests/notification-schema.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Apply and verify the migration**

Run:

```bash
bun run src/db/apply-migrations.ts
```

Then query the configured database:

```sql
select name from _migrations where name = '0064_internal_notification_outbox.sql';
select count(*) from notification_events;
select count(*) from notification_recipients;
select count(*) from notification_outbox;
```

Expected: migration tracked once and all three queries succeed.

- [ ] **Step 9: Commit**

```bash
git add drizzle/0064_internal_notification_outbox.sql src/db/schema.ts \
  src/lib/notifications/contracts.ts src/lib/schemas/settings.ts \
  tests/notification-settings.test.ts tests/notification-schema.test.mjs
git commit -m "feat: add durable notification event schema"
```

---

### Task 2: Record events, recipients, and outbox atomically

**Files:**
- Create: `src/lib/notifications/events-core.ts`
- Create: `tests/notification-event-service.test.mjs`

**Interfaces:**
- Consumes: tables and `NotificationCategory` from Task 1.
- Produces:

```ts
export type CreateNotificationEventInput = {
  eventKey: string;
  category: NotificationCategory;
  entityType: "order" | "purchase" | "customer" | "supplier" | "payment";
  entityId: string;
  actorId?: string | null;
  target: NotificationTarget;
  priority: NotificationPriority;
  quietHoursPolicy: QuietHoursPolicy;
  directUserIds?: string[];
  excludeActor?: boolean;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

export async function createNotificationEventInTx(
  tx: DbLike,
  input: CreateNotificationEventInput,
): Promise<{ eventId: string; created: boolean } | null>;

export async function createDebtChangedEventInTx(
  tx: DbLike,
  input: {
    entityType: "customer" | "supplier";
    entityId: string;
    operationType: string;
    operationId: string;
    delta: number;
    actorId?: string | null;
    relatedAdjustments?: Array<{
      entityType: "customer" | "supplier";
      entityId: string;
      delta: number;
    }>;
  },
): Promise<{ eventId: string; created: boolean } | null>;
```

- [ ] **Step 1: Write atomicity and routing tests**

Create a PGlite test that inserts owner, manager, cashier, warehouse, and inactive profiles, then asserts:

```js
const created = await db.transaction((tx) =>
  events.createNotificationEventInTx(tx, {
    eventKey: "purchase-received:10000000-0000-0000-0000-000000000001",
    category: "purchaseReceived",
    entityType: "purchase",
    entityId: "10000000-0000-0000-0000-000000000001",
    actorId: warehouse.id,
    target: "purchases",
    priority: "normal",
    quietHoursPolicy: "defer",
    excludeActor: true,
  }),
);

ok("event created", created?.created === true);
ok("routes owner and manager but excludes actor/inactive", recipientIds.length === 2);
ok("outbox created in same transaction", outboxRows.length === 1);
```

Also cover:

- `qrPaymentConfirmed` includes a direct cashier plus owner/manager;
- duplicate `eventKey` returns the same event ID with `created: false`;
- category disabled in store prefs returns `null`;
- a forced transaction throw leaves zero event/recipient/outbox rows.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
bun tests/notification-event-service.test.mjs
```

Expected: module missing.

- [ ] **Step 3: Implement deterministic helpers and settings snapshot**

In `events-core.ts`, export:

```ts
export function debtEventKey(input: {
  entityType: "customer" | "supplier";
  entityId: string;
  operationType: string;
  operationId: string;
}) {
  return [
    "debt-changed",
    input.entityType,
    input.entityId,
    input.operationType,
    input.operationId,
  ].join(":");
}
```

Also implement `createDebtChangedEventInTx`. It rounds `delta` and every related adjustment to two decimal places, returns `null` when the net result is zero, selects target `debt`, priority `normal`, quiet-hours policy `defer`, excludes the actor, and stores only `{ delta, operationType, relatedAdjustments }` in protected metadata. Omit `relatedAdjustments` when the mutation touches only the primary entity.

Inside `createNotificationEventInTx`:

1. Select singleton `storeSettings.prefs` through `tx`.
2. Parse it with `parseStorePrefs`.
3. Return `null` when the category boolean is disabled.
4. Insert event with `onConflictDoNothing`, then select the existing event on conflict.
5. If newly created, select active profiles whose roles match `roleRouting[category]`.
6. Resolve direct IDs through active profiles, merge them with role recipients, remove duplicates, and remove the actor only when `excludeActor` is true and that actor was not included directly.
7. Insert recipients and one outbox row.

- [ ] **Step 4: Run event tests**

Run:

```bash
bun tests/notification-event-service.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Run migration and settings regressions**

Run:

```bash
bun tests/notification-schema.test.mjs
bun test tests/notification-settings.test.ts tests/push-notification-policy.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/events-core.ts \
  tests/notification-event-service.test.mjs
git commit -m "feat: record notification events atomically"
```

---

### Task 3: Add the replaceable queue boundary and QStash adapter

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/lib/notifications/queue/config.ts`
- Create: `src/lib/notifications/queue/qstash.ts`
- Create: `tests/notification-queue-contract.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: queue interfaces/message from Task 1.
- Produces:

```ts
export function resolveNotificationQueue(
  env?: Record<string, string | undefined>,
): {
  provider: string;
  publisher: NotificationQueuePublisher;
  verifier: NotificationQueueRequestVerifier;
};
```

- [ ] **Step 1: Write provider contract tests with a fake**

Create `tests/notification-queue-contract.test.ts`:

```ts
const message: NotificationQueueMessageV1 = {
  version: 1,
  eventId: "10000000-0000-0000-0000-000000000001",
  deduplicationKey: "notification:10000000-0000-0000-0000-000000000001",
  queuedAt: "2026-07-28T12:00:00.000Z",
};

test("queue resolver rejects an unconfigured provider", () => {
  expect(() => resolveNotificationQueue({
    NOTIFICATION_QUEUE_PROVIDER: "qstash",
  })).toThrow("NOTIFICATION_QUEUE_NOT_CONFIGURED");
});

test("publisher transports only the neutral envelope", async () => {
  const published: unknown[] = [];
  const fake: NotificationQueuePublisher = {
    async publish(value) {
      published.push(value);
      return { providerMessageId: "fake-1" };
    },
  };
  await fake.publish(message);
  expect(published).toEqual([message]);
});
```

Construct the QStash verifier with an injected fake `Receiver` in tests. Assert the adapter passes the raw body, `Upstash-Signature`, and configured worker URL to `receiver.verify`, returns `message` when the fake returns true, and rejects when it returns false. The physical SIT in Task 10 verifies real QStash signatures.

Keep the SDK-shaped test seam local to the adapter:

```ts
type QstashReceiverLike = {
  verify(input: {
    signature: string;
    body: string;
    url: string;
  }): Promise<boolean>;
};
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
bun test tests/notification-queue-contract.test.ts
```

Expected: resolver and adapter modules missing.

- [ ] **Step 3: Install the official SDK**

Run:

```bash
bun add @upstash/qstash
```

Expected: `package.json` and `bun.lock` add `@upstash/qstash`.

- [ ] **Step 4: Implement QStash adapter only in `queue/qstash.ts`**

Use:

```ts
const client = new Client({
  token: config.token,
  enableTelemetry: false,
});

const result = await client.publishJSON({
  url: config.workerUrl,
  body: message,
  deduplicationId: message.deduplicationKey,
  retries: 10,
  retryDelay: "max(1000, pow(2, retried) * 1000)",
  timeout: "15s",
});
```

The verifier must read the raw request body, verify `Upstash-Signature` with current and next keys plus the configured worker URL, parse JSON, and validate:

- `version === 1`;
- UUID `eventId`;
- non-empty `deduplicationKey` up to 200 characters;
- valid ISO `queuedAt`.

Do not forward headers or business metadata.

- [ ] **Step 5: Implement strict runtime configuration**

`queue/config.ts` must support exactly `qstash`; missing/unknown provider or credentials throws `NOTIFICATION_QUEUE_NOT_CONFIGURED`. Do not create an inline production sender that bypasses the outbox.

- [ ] **Step 6: Document server-only environment values**

Add to `.env.example`:

```text
NOTIFICATION_QUEUE_PROVIDER=qstash
NOTIFICATION_QUEUE_WORKER_URL=https://pos.example.com/api/workers/notifications/push
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

- [ ] **Step 7: Run queue tests and lint**

Run:

```bash
bun test tests/notification-queue-contract.test.ts
bunx eslint src/lib/notifications/contracts.ts \
  src/lib/notifications/queue/config.ts \
  src/lib/notifications/queue/qstash.ts \
  tests/notification-queue-contract.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock .env.example \
  src/lib/notifications/queue tests/notification-queue-contract.test.ts
git commit -m "feat: add replaceable notification queue adapter"
```

---

### Task 4: Build outbox publication, FCM delivery, and the worker

**Files:**
- Create: `src/lib/notifications/fcm-message.ts`
- Create: `src/lib/notifications/outbox-core.ts`
- Create: `src/lib/notifications/outbox.ts`
- Create: `src/lib/actions/notification-operations.ts`
- Modify: `src/lib/notifications/push.ts`
- Create: `src/app/api/workers/notifications/push/route.ts`
- Create: `src/app/api/cron/notifications/outbox/route.ts`
- Create: `tests/notification-outbox-worker.test.mjs`
- Modify: `tests/push-notification-policy.test.ts`

**Interfaces:**
- Consumes: event/outbox schema, queue resolver, existing Firebase service-account and device binding.
- Produces:

```ts
export async function publishCommittedNotification(eventId: string): Promise<void>;
export async function recoverDueNotifications(limit?: number): Promise<number>;
export async function processNotificationMessage(
  message: NotificationQueueMessageV1,
): Promise<{ completed: boolean; retryAt?: Date }>;
export async function republishDeadNotificationForUser(
  userId: string,
  eventId: string,
): Promise<ActionResult<void>>;
```

- [ ] **Step 1: Write pure payload/error tests**

Extend `tests/push-notification-policy.test.ts`:

```ts
test("QR payload is high priority and privacy safe", () => {
  const payload = buildFcmMessage({
    token: "token",
    locale: "vi",
    eventId: EVENT_ID,
    notificationKey: `event:${EVENT_ID}`,
    category: "qrPaymentConfirmed",
    target: "invoices",
    entityId: ORDER_ID,
  });
  expect(payload.message.notification).toEqual({
    title: "Đã xác nhận thanh toán QR",
    body: "Mở LumaPOS để xem chi tiết.",
  });
  expect(payload.message.apns.headers).toMatchObject({
    "apns-priority": "10",
    "apns-push-type": "alert",
  });
  expect(JSON.stringify(payload)).not.toContain("1000000");
});

test("classifies retryable and permanent FCM failures", () => {
  expect(classifyFcmFailure(429, { error: { status: "RESOURCE_EXHAUSTED" } }))
    .toMatchObject({ kind: "retry" });
  expect(classifyFcmFailure(404, { error: { status: "UNREGISTERED" } }))
    .toEqual({ kind: "disable-token", code: "FCM_UNREGISTERED" });
  expect(classifyFcmFailure(401, { error: { status: "UNAUTHENTICATED" } }))
    .toEqual({ kind: "permanent", code: "FCM_UNAUTHENTICATED" });
});
```

- [ ] **Step 2: Write PGlite worker-state tests**

Cover:

- one worker claims an event and a concurrent worker cannot claim it;
- an already sent device/notification pair is skipped;
- routine quiet-hours event changes to `retry` with `availableAt` at quiet-hours end;
- QR event bypasses quiet hours;
- retryable sender result increments attempts and sets retry time;
- permanent sender result reaches `dead`;
- tenth attempt or sixty-minute age reaches `dead`;
- success marks outbox completed and stores per-device sent delivery;
- recovery claims only due `pending`/`retry` rows.
- disabled push channel leaves the in-app recipient visible, sends no FCM request, and completes the outbox without retry;
- a direct QR recipient must still resolve to an active profile/device;
- only owner/manager can reset and republish a `dead` event, and republishing preserves the event ID and delivery dedupe key.

Inject a fake publisher and fake device sender into the core functions.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
bun test tests/push-notification-policy.test.ts
bun tests/notification-outbox-worker.test.mjs
```

Expected: new functions/modules missing.

- [ ] **Step 4: Extract message construction and single-device send**

Move OAuth token acquisition and raw FCM HTTP call behind a lower-level function in `push.ts`:

```ts
export async function sendNotificationToDevice(
  input: DeviceNotificationInput,
): Promise<DeviceNotificationResult>;
```

Keep `dispatchPushNotification` as the compatibility wrapper used by low-stock/e-invoice cron. It must call the same single-device sender so old and new flows share token invalidation and error classification.

- [ ] **Step 5: Implement provider-neutral outbox state machine**

In `outbox-core.ts`, inject `database`, `publisher`, `sender`, `now`, and random jitter. Use conditional updates and `returning()` for leases. Never hold a database transaction open during QStash or FCM network calls.

Before device delivery, re-read the authoritative notification settings and active recipient/device bindings. A store-wide category disabled before processing cancels FCM while preserving the persisted event. A disabled push channel also skips FCM and completes the outbox; neither setting deletes the authenticated in-app notification. Direct recipients bypass only role routing, never active-profile, active-device, category, or channel checks.

State rules:

```text
pending/retry -> publishing -> published
published/retry -> processing -> completed
processing failure -> retry
attempt_count >= 10 or first_attempt_at older than 60 minutes -> dead
```

Use `event:<event-id>` as `mobilePushDeliveries.notificationKey`.

- [ ] **Step 6: Implement production wrappers and routes**

The worker route:

```ts
export async function POST(request: Request) {
  const { verifier } = resolveNotificationQueue();
  let message: NotificationQueueMessageV1;
  try {
    message = await verifier.verify(request);
  } catch (error) {
    if (
      error instanceof NotificationQueueVerificationError
      && error.reason === "invalid_message"
    ) {
      recordNotificationQueueRejection("invalid_message");
      return mobileError("errors.invalidData", 400);
    }
    recordNotificationQueueRejection("invalid_signature");
    return mobileError("errors.unauthorized", 401);
  }
  try {
    return mobileOk(await processNotificationMessage(message));
  } catch {
    return mobileError("errors.serverError", 500);
  }
}
```

The recovery route reuses the constant-time bearer validation pattern from `src/app/api/cron/notifications/route.ts`, calls `recoverDueNotifications(50)`, and returns counts only.

Implement `republishDeadNotificationForUser` as an owner/manager-only server action. In one short transaction it conditionally resets a matching `dead` row to `pending`, clears its lease/error, and keeps the original event and delivery records. After commit it calls `publishCommittedNotification(eventId)`. Return a conflict when the row is no longer `dead`; never create a replacement event.

Invalid signatures and unsupported envelope versions return `401`/`400` respectively and increment only a safe counter containing provider, result class, and envelope version—never headers, raw body, or event metadata.

- [ ] **Step 7: Run focused tests**

Run:

```bash
bun test tests/push-notification-policy.test.ts \
  tests/notification-queue-contract.test.ts
bun tests/notification-outbox-worker.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Run lint**

Run:

```bash
bunx eslint src/lib/notifications src/app/api/workers/notifications \
  src/app/api/cron/notifications tests/push-notification-policy.test.ts \
  tests/notification-queue-contract.test.ts
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications src/lib/actions/notification-operations.ts \
  src/app/api/workers/notifications \
  src/app/api/cron/notifications tests/notification-outbox-worker.test.mjs \
  tests/push-notification-policy.test.ts
git commit -m "feat: process durable notification outbox"
```

---

### Task 5: Emit invoice, purchase, and standalone debt events

**Files:**
- Modify: `src/lib/orders/create.ts`
- Modify: `src/lib/orders/convert.ts`
- Modify: `src/lib/orders/cancel.ts`
- Modify: `src/lib/orders/payment-core.ts`
- Modify: `src/lib/orders/payment.ts`
- Modify: `src/lib/actions/marketplace.ts`
- Modify: `src/lib/actions/purchases.ts`
- Modify: `src/lib/actions/purchase-returns.ts`
- Modify: `src/lib/actions/returns.ts`
- Create: `tests/notification-business-events.test.mjs`
- Modify: `tests/manual-payment-idempotency.test.mjs`
- Modify: `tests/purchase-batch-contract.test.ts`

**Interfaces:**
- Consumes: `createNotificationEventInTx`, `debtEventKey`, and `publishCommittedNotification`.
- Produces: deterministic `invoiceCreated`, `purchaseReceived`, and `debtChanged` events from existing authoritative mutations.

- [ ] **Step 1: Write business-event integration tests**

Using PGlite, cover:

```js
ok("completed sale emits invoice event", event.category === "invoiceCreated");
ok("completed marketplace import emits invoice event once", marketplaceEvents.length === 1);
ok("exchange order emits invoice event instead of debt event", exchangeInvoiceEvents.length === 1);
ok("quote and booking emit no invoice event", quoteEvents.length === 0);
ok("received purchase emits purchase event", purchaseEvent.category === "purchaseReceived");
ok("draft purchase emits no event", draftEvents.length === 0);
ok("manual debt payment emits debt event", debtEvent.category === "debtChanged");
ok("idempotent manual payment replay emits one event", debtEvents.length === 1);
ok("purchase event absorbs supplier debt delta", purchaseDebtEvents.length === 0);
```

Add rollback assertions for insufficient stock and invalid batch receipt.

- [ ] **Step 2: Run new and affected tests to confirm failure**

Run:

```bash
bun tests/notification-business-events.test.mjs
bun tests/manual-payment-idempotency.test.mjs
bun test tests/purchase-batch-contract.test.ts
```

Expected: event assertions fail.

- [ ] **Step 3: Emit invoice events in completed-order paths**

Inside the same transaction that first writes `orders.status = "completed"`:

```ts
const notification = await createNotificationEventInTx(tx, {
  eventKey: `invoice-created:${order.id}`,
  category: "invoiceCreated",
  entityType: "order",
  entityId: order.id,
  actorId: profileId,
  target: "invoices",
  priority: "normal",
  quietHoursPolicy: "defer",
  excludeActor: true,
  metadata: {
    debtDelta: remaining.toFixed(2),
    source: v.source?.mode ?? "sale",
  },
});
```

Do this for:

- a direct completed sale in `src/lib/orders/create.ts`;
- a quote converted to completed in `src/lib/orders/convert.ts`;
- a non-cancelled completed marketplace import in `src/lib/actions/marketplace.ts`;
- a completed exchange order in `src/lib/actions/returns.ts`.

Do not emit for quote, booking, portal quote, cancelled marketplace import, pending QR draft, historical import scripts, merged replacement orders in `src/lib/orders/edit.ts`, or a transaction whose primary event is QR. A marketplace replay must reuse the external-order mapping and emit no duplicate. An exchange uses `invoiceCreated` as its primary event, so any debt delta stays only in protected event metadata and must not create a second `debtChanged` event.

After commit, call `publishCommittedNotification` only when `notification?.created` is true. The helper catches queue failures so the sale result stays successful.

- [ ] **Step 4: Emit purchase events**

Create `purchaseReceived` in `createPurchase` and only on `draft -> received` transition in `updatePurchase`. Include supplier debt delta in protected metadata. Do not emit a second supplier debt event from the same transaction.

- [ ] **Step 5: Emit standalone debt events**

Extend `addManualPaymentCore` success data:

```ts
{ replayed: boolean; notificationEventId?: string }
```

Create a `debtChanged` event for manual customer payment using the payment/client request ID as operation ID. Call the publisher in `addPaymentForUser`.

Call `createDebtChangedEventInTx` once at the end of each transaction with the net balance delta:

| Mutation | `entityType` | `operationType` | `operationId` |
| --- | --- | --- | --- |
| Order cancellation debt reversal | `customer` | `order_cancel` | order ID |
| Purchase edit debt difference | `supplier` | `purchase_edit` | `<purchase ID>:<committed mutation timestamp>` |
| Purchase cancellation debt reversal | `supplier` | `purchase_cancel` | purchase ID |
| Purchase return debt deduction | `supplier` | `purchase_return` | purchase-return ID |
| Customer return/refund debt adjustment | `customer` | `sale_return` | return ID |

At each call site, retain the return value outside the transaction result so the production wrapper can publish it only after commit:

```ts
const debtNotification = await createDebtChangedEventInTx(tx, {
  entityType: "customer",
  entityId: customerId,
  operationType: "order_cancel",
  operationId: order.id,
  delta: -reversedDebt,
  actorId: profileId,
});
```

Pass the signed delta applied to `currentDebt`, not the resulting balance. The helper suppresses rounded zero deltas. If a transaction adjusts both an old and a new supplier, still create only one primary event: use the purchase's resulting supplier as `entityId`, use the net signed delta as `delta`, and pass both ledger changes as `relatedAdjustments`. The mobile action opens the resulting supplier while the authenticated detail API remains authoritative for both ledgers.

For `purchase_edit`, obtain the mutation timestamp from the authoritative
purchase `UPDATE ... RETURNING` statement and append it to the purchase ID.
This gives each committed debt-changing edit a distinct deterministic operation
ID. A replay that applies a rounded-zero debt delta still creates no event.

- [ ] **Step 6: Run integration and regression tests**

Run:

```bash
bun tests/notification-business-events.test.mjs
bun tests/manual-payment-idempotency.test.mjs
bun test tests/purchase-batch-contract.test.ts \
  tests/purchase-batch-policy.test.ts
```

Expected: all pass.

- [ ] **Step 7: Lint changed business files**

Run:

```bash
bunx eslint src/lib/orders src/lib/actions/purchases.ts \
  src/lib/actions/purchase-returns.ts src/lib/actions/returns.ts
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/orders src/lib/actions/purchases.ts \
  src/lib/actions/marketplace.ts src/lib/actions/purchase-returns.ts \
  src/lib/actions/returns.ts \
  tests/notification-business-events.test.mjs \
  tests/manual-payment-idempotency.test.mjs \
  tests/purchase-batch-contract.test.ts
git commit -m "feat: emit invoice purchase and debt events"
```

---

### Task 6: Emit idempotent QR confirmation and exception events

**Files:**
- Modify: `src/lib/payments/service-core.ts`
- Modify: `src/lib/payments/service.ts`
- Modify: `src/app/api/payments/sepay/webhook/route.ts`
- Modify: `tests/sepay-payment-service.test.mjs`
- Modify: `tests/gateway-payment-service.test.mjs`

**Interfaces:**
- Consumes: event helper/outbox publisher.
- Produces:

```ts
type PaymentNotificationResult = {
  notificationEventId?: string;
  notificationCreated?: boolean;
};
```

- [ ] **Step 1: Add failing SePay confirmation/replay/exception tests**

After webhook confirmation, assert:

```js
const qrEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.category, "qrPaymentConfirmed"));
ok("QR confirmation emits once", qrEvents.length === 1);
ok("QR event points to order", qrEvents[0].entityId === order.id);
ok("QR event absorbs debt change", debtEvents.length === 0);
```

Replay the same webhook and assert event count remains one.

For missing reference, pending payment not found, and amount mismatch, assert one `qrPaymentException` keyed by webhook event ID and reason. Replay each event and assert no duplicate.

- [ ] **Step 2: Add failing hosted-gateway confirmation test**

In `tests/gateway-payment-service.test.mjs`, confirm a QR-capable hosted payment and assert `confirmPaymentInTx` creates one `qrPaymentConfirmed` event with the payment creator as direct recipient.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
bun tests/sepay-payment-service.test.mjs
bun tests/gateway-payment-service.test.mjs
```

Expected: notification event assertions fail.

- [ ] **Step 4: Create confirmation event at the authoritative transition**

In `confirmPaymentInTx`, after the payment/order/cash/debt mutations and only when the payment was not already terminal:

```ts
const notification = await createNotificationEventInTx(tx, {
  eventKey: `qr-payment-confirmed:${payment.id}`,
  category: "qrPaymentConfirmed",
  entityType: "order",
  entityId: order.id,
  actorId: payment.createdBy,
  directUserIds: payment.createdBy ? [payment.createdBy] : [],
  target: "invoices",
  priority: "high",
  quietHoursPolicy: "bypass",
  metadata: {
    paymentId: payment.id,
    provider: payment.provider,
    debtDelta: draftOrder
      ? Math.max(total - newPaid, 0).toFixed(2)
      : (-amount).toFixed(2),
  },
});
return {
  alreadyConfirmed: false,
  notificationEventId: notification?.eventId,
  notificationCreated: notification?.created,
};
```

Do not create `invoiceCreated` or `debtChanged` in the same transaction.

- [ ] **Step 5: Create verified reconciliation exceptions**

Within `matchSepayWebhookEvent`, create deterministic exception events before returning these reasons:

- `missing_reference`;
- `pending_payment_not_found`;
- `amount_mismatch`.

Use:

```ts
eventKey: `qr-payment-exception:${event.id}:${reason}`
```

Target `paymentReconciliation`, entity ID `event.id`, priority high, quiet-hours bypass, owner/manager role routing.

- [ ] **Step 6: Publish only after commit**

Have the production wrappers in `service.ts` publish newly created event IDs after the core transaction returns. In the SePay route, keep webhook success independent of queue publication failure. Never publish from inside `confirmPaymentInTx`.

- [ ] **Step 7: Run payment suites**

Run:

```bash
bun tests/sepay-payment-service.test.mjs
bun tests/gateway-payment-service.test.mjs
bun tests/payment-expire-service.test.mjs
bun test tests/payment-gateway-adapter.test.ts \
  tests/payment-gateway-signatures.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/payments/service-core.ts src/lib/payments/service.ts \
  src/app/api/payments/sepay/webhook/route.ts \
  tests/sepay-payment-service.test.mjs \
  tests/gateway-payment-service.test.mjs
git commit -m "feat: notify internal staff of QR outcomes"
```

---

### Task 7: Expose persisted notifications and settings safely

**Files:**
- Modify: `src/app/api/mobile/notifications/route.ts`
- Modify: `src/app/api/mobile/notifications/[id]/route.ts`
- Modify: `src/app/api/mobile/notifications/settings/route.ts`
- Create: `src/lib/notifications/mobile-events.ts`
- Modify: `src/lib/settings/mobile-settings-access.ts`
- Modify: `src/app/(app)/settings/settings-client.tsx`
- Modify: `tests/notification-settings.test.ts`
- Create: `tests/mobile-notification-events.test.mjs`

**Interfaces:**
- Produces authenticated list and resolver responses:

```ts
type MobileNotificationEventRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  unread: boolean;
  priority: "normal" | "high";
  createdAt: string;
  action: {
    type: "open";
    target: NotificationTarget;
    id: string;
  };
};

type MobileNotificationResolution = {
  eventId: string;
  category: NotificationCategory;
  target: NotificationTarget;
  entityType: string;
  entityId: string;
};
```

- [ ] **Step 1: Write API projection/authorization tests**

Cover:

- recipient sees persisted event;
- unrelated active user cannot list or resolve it;
- dismissed recipient does not see it;
- PATCH updates `notification_recipients.readAt/dismissedAt`;
- legacy synthetic ID still uses `mobile_notification_states`;
- response excludes protected metadata and actor UUID;
- Vietnamese/English titles match category;
- manager receives extended settings while cashier does not.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
bun tests/mobile-notification-events.test.mjs
bun test tests/notification-settings.test.ts
```

Expected: persisted event API behavior missing.

- [ ] **Step 3: Merge persisted rows into notification listing**

Implement the persistence queries and privacy-reduced projections in `src/lib/notifications/mobile-events.ts`. Query `notificationRecipients -> notificationEvents` by effective profile, filter `dismissedAt is null`, and merge the result in the route with existing low-stock/e-invoice/shift synthetic rows. Sort descending by creation time and return stable category counts.

Do not expose `metadata`.

- [ ] **Step 4: Add authenticated event resolution**

Add `GET` to `src/app/api/mobile/notifications/[id]/route.ts`. It must join through `notificationRecipients.userId = current effective profile` and return only the resolution projection.

Update `PATCH` to modify a matching recipient first; fall back to `mobileNotificationStates` only when no persisted recipient exists.

- [ ] **Step 5: Extend web and mobile settings projections**

Add five category switches to `NotificationsSection` and matching mobile settings data. Add Vietnamese and English labels. Keep role-routing administration owner/manager-only.

- [ ] **Step 6: Run focused tests and lint**

Run:

```bash
bun tests/mobile-notification-events.test.mjs
bun test tests/notification-settings.test.ts \
  tests/mobile-settings-access.test.ts
bunx eslint 'src/app/api/mobile/notifications' \
  'src/app/(app)/settings/settings-client.tsx' \
  src/lib/settings/mobile-settings-access.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/mobile/notifications \
  src/lib/notifications/mobile-events.ts \
  src/lib/settings/mobile-settings-access.ts \
  'src/app/(app)/settings/settings-client.tsx' \
  tests/mobile-notification-events.test.mjs \
  tests/notification-settings.test.ts
git commit -m "feat: expose persisted internal notifications"
```

---

### Task 8: Validate and resolve versioned push events in Flutter

**Files:**
- Modify: `../luma-pos-mobile/lib/src/core/notifications/push_notification_service.dart`
- Modify: `../luma-pos-mobile/lib/src/core/api/mobile_endpoints.dart`
- Modify: `../luma-pos-mobile/lib/src/core/api/mobile_data_repository.dart`
- Modify: `../luma-pos-mobile/test/core/notifications/push_notification_service_test.dart`

**Interfaces:**
- Consumes: FCM payload and authenticated resolver API from Task 7.
- Produces:

```dart
class PushMessageEvent {
  const PushMessageEvent({
    required this.source,
    required this.eventId,
    required this.target,
    required this.category,
    required this.entityId,
  });

  final PushMessageSource source;
  final String eventId;
  final String target;
  final String category;
  final String entityId;
}
```

And:

```dart
Future<ApiResponse<Object?>> resolveNotification(String eventId);
```

- [ ] **Step 1: Write failing payload validation tests**

Add tests for:

- version `1` with a supported category/target and non-empty event/entity IDs succeeds;
- missing/wrong version is rejected;
- malformed event ID/entity ID is rejected;
- `purchases` and `paymentReconciliation` are accepted;
- unknown category/target is rejected;
- login-state message remains non-replayable.

Use:

```dart
messaging.openedMessages.add(const {
  'kind': 'operational_alert',
  'version': '1',
  'eventId': '10000000-0000-0000-0000-000000000001',
  'category': 'purchaseReceived',
  'target': 'purchases',
  'entityId': '20000000-0000-0000-0000-000000000001',
});
```

- [ ] **Step 2: Run the focused Flutter test and confirm failure**

Run:

```bash
flutter test test/core/notifications/push_notification_service_test.dart
```

Expected: versioned fields/targets not supported.

- [ ] **Step 3: Implement strict mobile validation**

Add category and target allow-lists. Require `kind`, `version`, `eventId`, `category`, `target`, and `entityId`. Keep parsing side-effect free.

- [ ] **Step 4: Add resolver endpoint/repository method**

Add:

```dart
static const notifications = '/api/mobile/notifications';

Future<ApiResponse<Object?>> resolveNotification(String eventId) {
  return _client.getJson(
    '${MobileEndpoints.notifications}/$eventId',
    decode: (json) => json,
  );
}
```

- [ ] **Step 5: Run focused tests and analyze**

Run:

```bash
flutter test test/core/notifications/push_notification_service_test.dart
flutter analyze lib/src/core/notifications/push_notification_service.dart \
  lib/src/core/api/mobile_endpoints.dart \
  lib/src/core/api/mobile_data_repository.dart
```

Expected: all pass.

- [ ] **Step 6: Commit in the mobile repository**

```bash
git -C ../luma-pos-mobile add \
  lib/src/core/notifications/push_notification_service.dart \
  lib/src/core/api/mobile_endpoints.dart \
  lib/src/core/api/mobile_data_repository.dart \
  test/core/notifications/push_notification_service_test.dart
git -C ../luma-pos-mobile commit -m "feat(mobile): validate internal push events"
```

---

### Task 9: Deep-link Flutter to the exact authorized entity

**Files:**
- Modify: `../luma-pos-mobile/lib/src/core/widgets/app_shell.dart`
- Modify: `../luma-pos-mobile/lib/src/features/more/presentation/invoices_screen.dart`
- Modify: `../luma-pos-mobile/lib/src/features/inventory/presentation/inventory_screen.dart`
- Modify: `../luma-pos-mobile/lib/src/features/customers/presentation/customers_screen.dart`
- Modify: `../luma-pos-mobile/lib/src/features/more/presentation/suppliers_screen.dart`
- Modify: `../luma-pos-mobile/lib/src/features/more/presentation/payment_reconciliation_screen.dart`
- Modify: `../luma-pos-mobile/lib/src/features/more/presentation/notifications_screen.dart`
- Modify: `../luma-pos-mobile/test/widget_test.dart`

**Interfaces:**
- Consumes: validated `PushMessageEvent` and `resolveNotification`.
- Produces optional initial-focus constructor parameters:

```dart
InvoicesScreen(initialInvoiceId: entityId)
InventoryScreen(initialTab: 'purchases', initialPurchaseId: entityId)
CustomersScreen(initialCustomerId: entityId)
SuppliersScreen(initialSupplierId: entityId)
PaymentReconciliationScreen(initialEventId: entityId)
```

- [ ] **Step 1: Write failing widget tests**

Add tests that:

- opened invoice event calls resolver then opens the matching invoice detail;
- purchase event opens Inventory on the purchases tab and highlights/scrolls to the receipt;
- customer debt resolution opens the matching customer profile;
- supplier debt resolution opens the matching supplier;
- QR exception opens reconciliation focused on the event;
- unauthorized/missing resolution opens Notifications and shows localized unavailable feedback;
- foreground event increments badge and waits for View.
- notification settings render and submit all five new category booleans and role routes without dropping legacy keys.

- [ ] **Step 2: Run targeted widget tests and confirm failure**

Run:

```bash
flutter test test/widget_test.dart --plain-name "opened internal push"
flutter test test/widget_test.dart --plain-name "foreground internal push"
```

Expected: exact-entity routes are absent.

- [ ] **Step 3: Resolve before navigating**

Change AppShell foreground View and opened-message paths to:

1. call `resolveNotification(event.eventId)`;
2. confirm resolved category/target/entity match the validated payload;
3. route using the authorized resolver projection;
4. fall back to Notifications with localized feedback on 403/404/malformed response.

Do not navigate from payload fields alone.

- [ ] **Step 4: Add exact-entity focus to destination screens**

After each screen finishes loading:

- locate the matching record by server UUID;
- open the existing detail flow once;
- guard with `_didOpenInitialEntity`;
- if absent, leave the list usable and show a localized unavailable snackbar.

For inventory receipts, carry server purchase UUID separately from the displayed receipt code in `_ReceiptPreview`.

For debt resolution, use resolver `entityType` to choose Customers or Suppliers.

- [ ] **Step 5: Keep notification-center actions consistent**

Pass an `onOpenNotificationEvent(eventId)` callback from AppShell into NotificationsScreen. Both a push View action and a notification-center row call AppShell's `_resolveAndOpenNotification`, so there is one resolver and target switch.

- [ ] **Step 6: Extend mobile notification settings controls**

Add localized controls for `invoiceCreated`, `purchaseReceived`, `debtChanged`, `qrPaymentConfirmed`, and `qrPaymentException`. Populate them only from the authoritative settings response and include them in `_notificationPrefsBody()` together with the complete role-routing map. Cashier and warehouse sessions must not see or submit the administrative controls.

- [ ] **Step 7: Run widget and notification tests**

Run:

```bash
flutter test test/core/notifications/push_notification_service_test.dart
flutter test test/widget_test.dart --plain-name "push"
flutter test test/widget_test.dart --plain-name "notification"
```

Expected: all pass.

- [ ] **Step 8: Analyze changed mobile files**

Run:

```bash
flutter analyze lib/src/core/widgets/app_shell.dart \
  lib/src/features/more/presentation/invoices_screen.dart \
  lib/src/features/inventory/presentation/inventory_screen.dart \
  lib/src/features/customers/presentation/customers_screen.dart \
  lib/src/features/more/presentation/suppliers_screen.dart \
  lib/src/features/more/presentation/payment_reconciliation_screen.dart \
  lib/src/features/more/presentation/notifications_screen.dart
```

Expected: no issues.

- [ ] **Step 9: Commit in the mobile repository**

```bash
git -C ../luma-pos-mobile add \
  lib/src/core/widgets/app_shell.dart \
  lib/src/features/more/presentation/invoices_screen.dart \
  lib/src/features/inventory/presentation/inventory_screen.dart \
  lib/src/features/customers/presentation/customers_screen.dart \
  lib/src/features/more/presentation/suppliers_screen.dart \
  lib/src/features/more/presentation/payment_reconciliation_screen.dart \
  lib/src/features/more/presentation/notifications_screen.dart \
  test/widget_test.dart
git -C ../luma-pos-mobile commit -m "feat(mobile): open push notification entities"
```

---

### Task 10: Add release checks, observability, and end-to-end evidence

**Files:**
- Modify: `src/app/api/cron/notifications/route.ts`
- Modify: `../luma-pos-mobile/README.md`
- Modify: `../luma-pos-mobile/docs/mobile_release_readiness_checklist.md`
- Modify: `../luma-pos-mobile/lib/src/core/release/production_release_preflight.dart`
- Modify: `../luma-pos-mobile/test/release/production_release_preflight_test.dart`
- Create: `docs/internal-push-operations-runbook.md`

**Interfaces:**
- Consumes: production configuration and outbox metrics.
- Produces: deploy/runbook evidence for SLA, recovery, secret rotation, and provider replacement.

- [ ] **Step 1: Write failing preflight tests**

Require production configuration to report these codes when absent:

```text
config.NOTIFICATION_QUEUE_PROVIDER
config.NOTIFICATION_QUEUE_WORKER_URL
config.QSTASH_TOKEN
config.QSTASH_CURRENT_SIGNING_KEY
config.QSTASH_NEXT_SIGNING_KEY
```

Assert `NOTIFICATION_QUEUE_PROVIDER` equals `qstash` for this release and worker URL is public HTTPS.

- [ ] **Step 2: Run preflight tests and confirm failure**

Run:

```bash
flutter test test/release/production_release_preflight_test.dart
```

Expected: new queue requirements are not enforced.

- [ ] **Step 3: Extend production preflight and documentation**

Update release config templates, owner map/checklist references, and README commands without printing secret values.

- [ ] **Step 4: Add privacy-safe operational summary**

Extend the protected notification cron response or a manager-only operations projection with:

```ts
{
  pending: number;
  retry: number;
  dead: number;
  oldestDueAgeSeconds: number;
  fcmAcceptedLastHour: number;
  fcmFailedLastHour: number;
  qrP95FcmAcceptedMs: number | null;
}
```

Never return tokens, metadata, payment amounts, or partner identity.

- [ ] **Step 5: Write the operations runbook**

Document exact procedures for:

- QStash token/signing-key setup and rotation;
- worker URL verification;
- Firebase/APNs readiness;
- replaying a dead outbox event through the application action;
- queue outage recovery;
- switching provider by implementing publisher/verifier contracts;
- interpreting event-to-queue, event-to-worker, and event-to-FCM latency;
- rollback by disabling new categories and queue publication without reverting business data.

- [ ] **Step 6: Run full backend verification**

Run:

```bash
bun test
for test_file in tests/*.mjs; do bun "$test_file"; done
bunx eslint .
bun run build
git diff --check
```

Expected: all tests, lint, build, and whitespace checks pass.

- [ ] **Step 7: Run full mobile verification**

Run from `../luma-pos-mobile`:

```bash
flutter test
flutter analyze
dart run tool/release_preflight.dart --help
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Perform physical-device SIT**

On one physical Android device and one physical iPhone:

1. grant notification permission and register tokens;
2. confirm a signed QR test payment;
3. record database event `created_at`, QStash publish/worker timestamps, and first successful FCM acceptance;
4. replay the webhook and confirm no second visible event/delivery;
5. force one worker `500`, observe QStash retry, then allow success;
6. disable queue publication, create an event, re-enable it, run recovery, and confirm delivery;
7. verify foreground View behavior and background/terminated exact-entity navigation;
8. verify a shared-terminal cashier switch cannot resolve the previous cashier's event.

Record at least twenty healthy QR samples. Expected:

```text
p95(notification_events.created_at -> first FCM acceptance) < 5000 ms
duplicate successful deliveries per device = 0
```

- [ ] **Step 9: Commit backend runbook/operations changes**

```bash
git add src/app/api/cron/notifications/route.ts \
  docs/internal-push-operations-runbook.md
git commit -m "docs: add internal push operations runbook"
```

- [ ] **Step 10: Commit mobile release changes**

```bash
git -C ../luma-pos-mobile add README.md \
  docs/mobile_release_readiness_checklist.md \
  lib/src/core/release/production_release_preflight.dart \
  test/release/production_release_preflight_test.dart
git -C ../luma-pos-mobile commit -m "chore(mobile): gate internal push release config"
```

---

## Final completion gate

- [ ] Confirm `git status --short` in both repositories contains no uncommitted task files and preserves unrelated user files.
- [ ] Confirm the web database has no pending migration and `0064_internal_notification_outbox.sql` is tracked.
- [ ] Confirm all five event categories can be disabled independently.
- [ ] Confirm direct QR recipient delivery is independent of role routing but still respects category and push-channel enablement.
- [ ] Confirm queue adapter contract tests pass with the fake and QStash implementations.
- [ ] Confirm no QStash imports exist outside `src/lib/notifications/queue/qstash.ts`.
- [ ] Confirm no raw token, service-account JSON, QStash secret, webhook body, partner identity, or amount appears in queue bodies, push payloads, logs, or metrics.
- [ ] Confirm p95 QR event-to-FCM acceptance is below five seconds across at least twenty healthy SIT samples.
- [ ] Confirm Android and iOS exact-entity navigation and shared-terminal isolation.
- [ ] Review commits in both repositories, then push each `main` only when doing so will not include unrelated unreviewed commits.
