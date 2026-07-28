# LumaPOS Internal Mobile Push Notifications — Execution Goal

## 1. Mission

Deliver durable internal mobile push notifications for completed invoice creation, received purchases, customer/supplier debt changes, QR payment confirmation, and QR reconciliation exceptions.

Build on the existing FlutterFire/FCM implementation. Do not replace working device registration, shared-terminal actor binding, role routing, quiet hours, or per-device delivery deduplication.

The authoritative design is:

`docs/superpowers/specs/2026-07-28-internal-mobile-push-events-design.md`

Read it completely before planning or implementation.

## 2. Required outcome

An authenticated LumaPOS employee receives the correct internal notification when an eligible business transaction commits.

The implementation must:

- persist the event and outbox atomically with the business mutation;
- deliver QR confirmation through an immediate queue path;
- achieve p95 under five seconds from transaction commit to FCM acceptance under healthy-provider conditions;
- retry transient failures without duplicating events or device deliveries;
- recover unpublished outbox rows independently of the queue provider;
- route taps to the correct authorized invoice, purchase, debt record, or reconciliation view;
- keep sensitive business and partner data off the lock screen;
- preserve principal/effective-user isolation on shared terminals.

FCM/APNs operating-system display latency is best effort and is not represented as a hard five-second guarantee.

## 3. Queue portability requirement

QStash is the initial queue provider, not an architectural dependency.

Business transactions, domain-event creation, recipient routing, outbox state, worker processing, FCM delivery, and Flutter navigation must remain provider-neutral.

Queue integrations must implement the versioned message and interfaces defined in the design:

```ts
type NotificationQueueMessageV1 = {
  version: 1;
  eventId: string;
  deduplicationKey: string;
  queuedAt: string;
};

interface NotificationQueuePublisher {
  publish(
    message: NotificationQueueMessageV1,
  ): Promise<{ providerMessageId: string }>;
}

interface NotificationQueueRequestVerifier {
  verify(request: Request): Promise<NotificationQueueMessageV1>;
}
```

No business module may import a QStash SDK or refer to QStash-specific headers, payloads, delivery states, or identifiers.

Changing to Vercel Queues, SQS, Cloud Tasks, or another provider must require only:

1. a new publisher adapter;
2. a new request verifier/consumer adapter;
3. deployment configuration changes;
4. passing the common adapter contract suite.

## 4. Event scope

### `invoiceCreated`

- Emit only when an order first becomes `completed` outside QR confirmation.
- Route to active owner and manager profiles.
- Exclude the actor by default.
- Defer during quiet hours.

### `purchaseReceived`

- Emit only when a purchase first becomes `received`.
- Route to active owner, manager, and warehouse profiles.
- Exclude the actor by default.
- Defer during quiet hours.

### `debtChanged`

- Cover both customer receivables and supplier payables.
- Emit only for a non-zero rounded balance delta that is not already represented by a higher-priority event.
- Route to active owner and manager profiles.
- Defer during quiet hours.

### `qrPaymentConfirmed`

- Emit only on the first transition into a confirmed/reconciled terminal payment state.
- Route directly to the payment creator and to active owner/manager profiles.
- Bypass quiet hours.
- Use high-priority user-visible delivery.

### `qrPaymentException`

- Emit for verified incoming QR transfers requiring reconciliation, including missing reference, pending payment not found, or amount mismatch.
- Route to active owner and manager profiles.
- Bypass quiet hours.
- Use high-priority user-visible delivery.

## 5. Noise-control rule

One business transaction produces at most one primary push:

```text
QR confirmation/exception
  > invoice or purchase creation
  > standalone debt change
```

When an invoice, purchase, or QR event changes debt, record the debt delta in protected event metadata. Do not emit a second debt push.

Webhook replay, API retry, server-action retry, queue redelivery, and recovery publication must converge on deterministic event keys.

## 6. Mandatory system components

### Durable event storage

Create immutable notification events and materialized recipient rows. The authenticated notification center must be able to display those same events consistently.

### Transactional outbox

Create provider-neutral outbox state with leases, attempt counts, next availability, safe error codes, provider reference, and completion/dead timestamps.

No network call is permitted inside the business database transaction.

### Immediate queue publication

After commit, publish the minimal versioned envelope through `NotificationQueuePublisher`.

Initial provider:

```text
NOTIFICATION_QUEUE_PROVIDER=qstash
```

Queue publication failure must not roll back a completed business operation.

### Authenticated worker

The queue-facing route verifies the provider request, parses the neutral envelope, and hands it to a provider-neutral worker.

The worker must be idempotent, lease the outbox row, resolve intended active devices, send through FCM, record device attempts, and transition the outbox deterministically.

### Recovery process

A protected scheduled process republishes due `pending` and `retry` rows. Recovery is a fallback, not the normal QR path.

### Mobile deep links

Flutter must validate message version, category, target, event ID, and entity ID. It must open the exact authorized entity after authentication and use a safe localized fallback when that entity is unavailable.

## 7. Privacy and security constraints

- Internal staff only; no customer or supplier recipient channel.
- No customer/supplier name, phone, address, amount, debt balance, bank account, webhook reference, or note on the lock screen.
- Queue envelopes contain identifiers only.
- QStash token and current/next signing keys remain server-only.
- Worker requests must be signature-verified.
- Recovery endpoints use a dedicated strong secret.
- Recipient resolution is server-owned; clients cannot nominate recipients.
- Event/detail APIs authorize the current effective user even after a valid push tap.
- Raw FCM tokens, Firebase service-account JSON, queue secrets, and payment webhook bodies must not enter logs or telemetry.

## 8. Reliability policy

- Delivery semantics are at least once.
- Event keys and per-device delivery keys make processing idempotent.
- Routine events defer through quiet hours instead of being skipped.
- QR events bypass quiet hours.
- Retry `429` according to provider guidance.
- Retry transient network and `5xx` errors with exponential backoff and jitter.
- Disable confirmed unregistered FCM tokens.
- Do not spin on permanent authentication, configuration, or invalid-payload failures.
- Move an outbox row to `dead` after ten attempts or sixty minutes from its first attempt, whichever occurs first.
- Authorized operations may republish a dead event using the same event key.

## 9. Required configuration

Server deployment:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
NOTIFICATION_QUEUE_PROVIDER=qstash
NOTIFICATION_QUEUE_WORKER_URL
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
NOTIFICATION_CRON_SECRET
```

Mobile release:

```text
LUMA_FIREBASE_API_KEY
LUMA_FIREBASE_PROJECT_ID
LUMA_FIREBASE_MESSAGING_SENDER_ID
LUMA_FIREBASE_ANDROID_APP_ID
LUMA_FIREBASE_IOS_APP_ID
LUMA_FIREBASE_IOS_BUNDLE_ID
```

Upload the production/development APNs authentication key to Firebase and retain the existing Android notification permission and iOS push/background capabilities.

## 10. Delivery phases

### Phase 1 — Neutral event and queue foundation

- Add event, recipient, and outbox schema.
- Add deterministic event creation inside business transactions.
- Define queue message and provider interfaces.
- Implement fake adapter contract tests.
- Add protected recovery processing.

### Phase 2 — QStash and FCM worker

- Implement QStash publisher and signature verifier.
- Implement provider-neutral worker processing.
- Extend FCM localization, priority, expiry, error parsing, and retry behavior.
- Add operational metrics and dead-letter visibility.

### Phase 3 — Business triggers and settings

- Integrate invoice, purchase, standalone debt, QR confirmation, and QR exception events.
- Enforce primary-event precedence.
- Extend notification settings and role routing.
- Merge persisted events into the mobile notification center API.

### Phase 4 — Flutter navigation and release verification

- Extend category/target allow-lists.
- Route by `entityId` to authorized detail screens.
- Preserve non-interrupting foreground behavior.
- Add Vietnamese and English copy.
- Verify Android and iOS physical-device delivery, replay safety, provider outage recovery, and measured QR latency.

## 11. Verification gates

Implementation cannot be declared complete without:

- migration applied through the repository migration runner;
- confirmation that no migration remains pending;
- database queries proving the new tables, constraints, and indexes exist;
- focused domain, transaction, queue contract, worker, retry, routing, and business-trigger tests;
- webhook replay and concurrent-worker tests;
- Flutter unit/widget tests for validation and exact-entity navigation;
- existing relevant backend and mobile regression suites;
- TypeScript lint/type checks and Flutter analyze;
- production web build;
- physical Android and iOS tests;
- a healthy-provider measurement showing QR event-to-FCM p95 below five seconds;
- a controlled QStash failure followed by successful outbox recovery;
- a repository status review that excludes unrelated user changes.

## 12. Acceptance criteria

The goal is achieved when:

1. Every scoped event is created only after the corresponding valid business transition.
2. Event, recipients, and outbox are atomic with the business transaction.
3. Rollback creates no notification artifacts.
4. QR confirmation reaches FCM acceptance with the defined p95 target.
5. A duplicated payment webhook produces one event and one successful delivery per device.
6. Routine quiet-hour events are delivered later rather than lost.
7. Recipients match direct and role routing while inactive or unauthorized profiles receive nothing.
8. Shared terminals do not leak notifications across effective cashier sessions.
9. Push content is privacy-safe and localized.
10. Notification taps open the exact authorized entity or a safe fallback.
11. Retry, dead-letter, recovery, and invalid-token paths are observable and verified.
12. QStash is fully isolated behind the neutral adapter boundary.
13. A fake replacement adapter passes the same contract suite without modifying business or FCM code.
14. All required automated and physical-device verification passes.
15. The completed implementation is committed and pushed to `origin/main` without including unrelated work.

## 13. Non-goals

- Customer or supplier notifications.
- Marketing messages or bulk campaigns.
- SMS, email, Zalo, or web-browser push.
- Replacing Firebase Cloud Messaging or APNs.
- Guaranteeing OS display within five seconds.
- Changing order, inventory, payment, return, or debt accounting semantics.
- Introducing queue-provider types into domain or business modules.
- Sending transaction amounts or partner identity on the lock screen.
