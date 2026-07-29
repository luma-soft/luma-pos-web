# Internal Mobile Push Events Design

## Objective

Extend the existing LumaPOS Firebase push foundation so authenticated staff receive durable, near-real-time operational notifications for:

- completed invoice creation;
- received purchase creation;
- customer and supplier debt changes;
- successful QR payment confirmation;
- QR payment exceptions that require reconciliation.

This is an internal staff-notification system. Customer and supplier messaging, promotional notifications, SMS, email, and Zalo delivery are outside this design.

The QR confirmation path targets a p95 duration below five seconds from the business transaction commit to FCM accepting the send request under normal provider operation. FCM and APNs are best-effort services, so the time at which the operating system displays a notification is measured separately and is not a hard guarantee.

## Existing foundation

The implementation must extend the current system rather than replace it:

- Flutter initializes Firebase, requests OS permission, registers and rotates FCM tokens, unregisters on logout, and handles foreground, background, and cold-start messages.
- The mobile API binds a physical device to both the authenticated principal and the effective quick-switch cashier.
- The backend sends through FCM HTTP v1, uses role routing and quiet hours, deduplicates per-device delivery, and disables tokens rejected as unregistered.
- The mobile notification center already supports read and dismissed state for existing operational alerts.
- Current scheduled push production covers low-stock and failed e-invoice alerts only.

The new design preserves those contracts while adding durable domain events, recipient records, a provider-neutral queue boundary, and document-level navigation.

## Architectural decision

Use a transactional outbox and a push-based queue worker:

```text
Business transaction
  -> immutable notification event + recipients + outbox row
  -> provider-neutral queue publisher
  -> QStash adapter
  -> authenticated notification worker
  -> recipient/device resolver
  -> FCM HTTP v1 adapter
  -> Flutter notification handling and authenticated detail fetch
```

The database transaction is authoritative. Queue delivery is an accelerator, not the source of truth.

QStash is the first queue provider because it can invoke a Vercel worker immediately and retry failed HTTP delivery without requiring a continuously running consumer. It must remain replaceable. Business modules, event storage, recipient resolution, the worker use case, FCM delivery, and Flutter code must not import a QStash SDK or reference QStash-specific fields.

## Provider-neutral queue boundary

### Versioned envelope

Every queue provider transports the same minimal envelope:

```ts
export type NotificationQueueMessageV1 = {
  version: 1;
  eventId: string;
  deduplicationKey: string;
  queuedAt: string;
};
```

The envelope contains no customer name, phone number, invoice amount, debt balance, access token, or other business payload. The worker loads the authoritative event from PostgreSQL after authenticating the queue request.

### Provider interfaces

Queue-specific code implements these boundaries:

```ts
export interface NotificationQueuePublisher {
  publish(
    message: NotificationQueueMessageV1,
  ): Promise<{ providerMessageId: string }>;
}

export interface NotificationQueueRequestVerifier {
  verify(request: Request): Promise<NotificationQueueMessageV1>;
}
```

The runtime resolver selects an implementation from:

```text
NOTIFICATION_QUEUE_PROVIDER=qstash
```

The initial implementation supplies:

- a QStash publisher;
- a QStash request-signature verifier;
- a fake publisher and verifier for contract tests;
- a disabled configuration that reports queue unavailability without silently pretending delivery succeeded.

A future Vercel Queues, SQS, Cloud Tasks, or another HTTP queue adapter implements the same interfaces. Changing providers must not require edits to order, purchase, debt, payment, recipient-routing, FCM, or Flutter modules.

### QStash configuration

The deployment supplies these server-only values:

```text
NOTIFICATION_QUEUE_PROVIDER=qstash
NOTIFICATION_QUEUE_WORKER_URL=https://<deployment>/api/workers/notifications/push
QSTASH_TOKEN=<server-only-token>
QSTASH_CURRENT_SIGNING_KEY=<server-only-key>
QSTASH_NEXT_SIGNING_KEY=<server-only-key>
```

The worker rejects unsigned, incorrectly signed, expired, malformed, or unsupported-version messages. QStash credentials never enter a client bundle, mobile API response, audit payload, or notification event.

## Data model

### `notification_events`

Immutable business-event record:

- `id`: UUID primary key.
- `event_key`: unique text idempotency key.
- `category`: validated text category.
- `entity_type`: `order`, `purchase`, `customer`, `supplier`, or `payment`.
- `entity_id`: UUID of the primary authenticated destination.
- `actor_id`: nullable profile that caused the event.
- `target`: validated mobile route target.
- `priority`: `normal` or `high`.
- `quiet_hours_policy`: `defer` or `bypass`.
- `metadata`: bounded JSON containing server-only routing context such as related entity IDs, debt delta, and reason.
- `occurred_at`: business occurrence timestamp.
- `created_at`: persistence timestamp.

`metadata` is not copied into the FCM data payload. API projections expose only fields authorized for the current effective user.

### `notification_recipients`

Materialized intended recipients:

- `event_id`: notification event.
- `user_id`: effective profile.
- `reason`: `role` or `direct`.
- `read_at`: nullable timestamp.
- `dismissed_at`: nullable timestamp.
- `created_at`: timestamp.

The unique key is `(event_id, user_id)`. Materializing recipients keeps the mobile notification center consistent with the original routing decision. Delivery still rechecks that both the device principal and effective profile are active.

### `notification_outbox`

Provider-neutral queue state:

- `id`: UUID primary key.
- `event_id`: unique notification event.
- `status`: `pending`, `publishing`, `published`, `processing`, `retry`, `completed`, or `dead`.
- `provider`: nullable provider identifier such as `qstash`.
- `provider_message_id`: nullable opaque provider reference.
- `attempt_count`: integer.
- `available_at`: next eligible publish or retry time.
- `lease_expires_at`: nullable worker lease.
- `last_error_code`: nullable bounded safe code.
- `published_at`, `first_attempt_at`, `completed_at`: nullable timestamps.
- `created_at`, `updated_at`: timestamps.

No provider-specific payload or signing data is stored in the outbox.

### Existing delivery table

`mobile_push_deliveries` remains the per-device delivery ledger. Its unique device/notification key prevents duplicate FCM sends when QStash provides at-least-once delivery or the recovery worker republishes an event.

## Event catalogue and routing

| Category | Creation condition | Default recipients | Target | Priority | Quiet hours |
| --- | --- | --- | --- | --- | --- |
| `invoiceCreated` | An order first becomes `completed` outside QR confirmation | Active owner and manager profiles, excluding the actor by default | `invoices` | Normal | Defer |
| `purchaseReceived` | A purchase first becomes `received` | Active owner, manager, and warehouse profiles, excluding the actor by default | `purchases` | Normal | Defer |
| `debtChanged` | Customer or supplier balance changes outside a higher-priority primary event | Active owner and manager profiles, excluding the actor by default | `debt` | Normal | Defer |
| `qrPaymentConfirmed` | A QR-backed payment first transitions to a confirmed or reconciled terminal status | Payment creator directly plus active owner and manager profiles | `invoices` | High | Bypass |
| `qrPaymentException` | Verified incoming QR transfer cannot be matched because of missing reference, missing payment, or amount mismatch | Active owner and manager profiles | `paymentReconciliation` | High | Bypass |

Duplicate users are collapsed to one recipient. A direct recipient remains eligible even if their role is not in the category role list, provided the profile and device binding are active.

### One primary notification per transaction

To prevent notification storms, a transaction emits at most one user-visible primary event:

1. `qrPaymentConfirmed` or `qrPaymentException`;
2. `invoiceCreated` or `purchaseReceived`;
3. `debtChanged`.

Debt deltas caused by invoice creation, purchase receipt, or QR confirmation are recorded in the primary event metadata and do not create a second debt push. `debtChanged` is used for standalone debt collection, manual payment, qualifying edit, cancellation, or return operations where no higher-priority event already represents the transaction.

No event is created when the rounded monetary balance is unchanged.

### Idempotency keys

Event keys are deterministic:

```text
invoice-created:<order-id>
purchase-received:<purchase-id>
debt-changed:<entity-type>:<entity-id>:<operation-type>:<operation-id>
qr-payment-confirmed:<payment-id>
qr-payment-exception:<webhook-event-id>:<reason>
```

For `purchase_edit`, the operation ID is
`<purchase-id>:<committed-mutation-timestamp>`, where the timestamp is returned
by the authoritative purchase update. This prevents one legitimate later edit
from colliding with an earlier edit, while rounded-zero replays remain silent.

Webhook replay, mobile retry, server-action retry, queue redelivery, and recovery publication must converge on the existing event and delivery rows.

## Transaction and queue flow

### Event creation

A transaction-aware helper accepts the existing Drizzle transaction object and:

1. inserts the immutable event with `on conflict do nothing`;
2. resolves and inserts recipient rows;
3. inserts the outbox row;
4. returns the event and outbox identifiers.

If the business transaction rolls back, event, recipients, and outbox roll back with it.

The helper performs database work only. It never calls QStash or FCM inside the transaction.

### Immediate publication

After a successful commit, the application asks the configured `NotificationQueuePublisher` to publish the versioned envelope.

- Business success is never rolled back because queue publication fails.
- On successful publication, the outbox becomes `published` with an opaque provider message ID.
- On failure, the outbox becomes `retry` and remains eligible for recovery.
- Concurrent publishers use a lease or conditional status update so only one publisher owns an attempt.

### Recovery

A protected recovery endpoint scans due `pending` and `retry` rows. It republishes them through the same provider-neutral publisher.

Recovery is a durability fallback and may run once per minute. It is not the normal QR delivery path and therefore does not define the sub-five-second SLA.

### Worker processing

The queue-facing route performs only provider verification and envelope parsing, then calls a provider-neutral worker use case.

The worker:

1. claims the outbox row with a bounded lease;
2. returns success immediately if the event is already completed;
3. loads the immutable event and intended recipients;
4. applies quiet-hour deferral when required;
5. resolves active devices using existing principal/effective-user security checks;
6. localizes and sends FCM messages;
7. records each device attempt in `mobile_push_deliveries`;
8. marks the outbox `completed`, `retry`, or `dead`.

Repeated worker calls are safe.

## Quiet hours and priority

- QR confirmation and QR reconciliation exceptions bypass quiet hours because they require immediate operational awareness.
- Invoice, purchase, and standalone debt events are deferred until the configured quiet period ends.
- Deferred events remain in the outbox with `available_at` set to the end of quiet hours; they are not marked skipped or lost.
- Android uses high priority only for QR categories and normal priority for routine activity.
- Apple QR alerts set `apns-push-type: alert` and `apns-priority: 10`; routine events use priority `5`.
- QR messages expire after ten minutes. Routine events expire after twenty-four hours.

## Notification content and privacy

Lock-screen content is generic and localized:

| Category | Vietnamese title | English title |
| --- | --- | --- |
| `invoiceCreated` | Hóa đơn mới đã được tạo | A new invoice was created |
| `purchaseReceived` | Đã ghi nhận phiếu nhập hàng | A purchase receipt was recorded |
| `debtChanged` | Công nợ vừa được cập nhật | A debt balance was updated |
| `qrPaymentConfirmed` | Đã xác nhận thanh toán QR | QR payment confirmed |
| `qrPaymentException` | Cần kiểm tra giao dịch QR | QR payment needs review |

The lock-screen body asks the user to open LumaPOS. It does not include customer or supplier names, phone numbers, addresses, invoice totals, payment amounts, debt balances, bank accounts, webhook references, or notes.

The FCM data payload contains only string values:

```ts
{
  kind: "operational_alert",
  version: "1",
  category: string,
  target: string,
  eventId: string,
  entityId: string,
  notificationKey: string
}
```

Flutter treats those fields as untrusted navigation hints. It validates category and target against allow-lists, requires an authenticated session, then fetches current authorized detail data through the mobile API.

## Mobile behavior

### Routing

The allowed-target contract adds:

- `purchases`;
- `paymentReconciliation`.

Document-level navigation consumes `entityId`:

- invoice and QR confirmation open the matching invoice;
- purchase receipt opens the matching purchase or the purchase tab focused on that row;
- customer debt opens the matching customer debt view;
- supplier debt opens the matching supplier debt view;
- QR exception opens the reconciliation screen focused on the relevant event.

If the entity is no longer accessible, the app opens the containing list and displays a localized unavailable message. It never displays cached protected detail from the push payload.

### Foreground behavior

Foreground messages:

- increment the notification badge once per event;
- show a localized snackbar/banner;
- do not interrupt an active sale;
- navigate only after the user selects View.

Background and cold-start taps navigate after session bootstrap. Messages received while the app is at Login remain discarded and are not replayed into a later shared-terminal session.

### Notification center

The mobile notifications endpoint merges persisted recipient events with current synthetic alerts. Read and dismiss mutations operate on `notification_recipients` for persisted events and retain compatibility with `mobile_notification_states` for legacy synthetic rows.

## Settings

Notification preferences add switches and role routes for:

- invoice creation;
- purchase receipt;
- debt changes;
- QR confirmation;
- QR exceptions.

Defaults follow the event-routing table. QR direct-recipient delivery cannot be removed by role routing, but an administrator may disable the category store-wide. Push-channel disablement prevents FCM delivery while keeping the authenticated in-app event visible.

Only owner and manager roles may change notification settings. Cashier and warehouse roles retain read access only to events routed to them.

## Failure handling

### Queue publication

- Network failure or provider `5xx`: mark `retry` with exponential backoff and jitter.
- Provider rate limit: honor provider retry guidance before republishing.
- Authentication or configuration failure: record a bounded error code, alert operations, and leave the event recoverable.
- Unsupported envelope version or invalid signature: reject without processing and emit a security-safe metric.

### FCM delivery

- `UNREGISTERED`/HTTP `404`: disable the device token and do not retry that device.
- Valid-payload token-specific invalid argument: disable the invalid token only after parsing the FCM error detail.
- `429`: honor `Retry-After`, otherwise wait at least sixty seconds.
- `500`/`503` and network timeout: retry with exponential backoff and jitter.
- `400`, `401`, and `403` configuration or payload failures: do not spin; move to `dead` after recording the safe error class.

Retries never create a new notification event.

### Dead letters

An outbox row becomes `dead` after ten worker attempts or sixty minutes after the first attempt, whichever comes first. Dead rows remain queryable for operations and can be manually republished by an authorized manager action using the same event key.

## Observability and SLA

Record metrics without business-sensitive labels:

- event-to-queue-publish latency;
- event-to-first-worker latency;
- event-to-FCM-accepted latency;
- queue publication failures;
- worker retry count;
- FCM accepted, failed, and invalid-token counts;
- oldest pending/retry outbox age;
- dead-letter count by category and safe error class.

The production SLA check is:

```text
p95(notification_events.created_at -> first successful FCM acceptance) < 5 seconds
```

It applies to `qrPaymentConfirmed` when PostgreSQL, QStash, the Vercel worker, OAuth token exchange, and FCM are healthy. Dashboards must distinguish provider latency from OS display latency.

Logs and telemetry must not contain raw FCM tokens, service-account JSON, QStash tokens/signing keys, payment webhook bodies, bank account numbers, customer contact data, or unrestricted event metadata.

## Security

- Queue publisher and verifier run server-side only.
- The QStash worker verifies current and next signing keys to support key rotation.
- Recovery endpoints use a dedicated secret and constant-time comparison.
- Event detail APIs authorize the effective user independently of push receipt.
- Recipient resolution uses server-owned profiles and roles; the client cannot nominate recipients.
- Device delivery retains the existing checks that principal and effective profiles are active.
- Shared-terminal quick switch updates the effective-user device binding before subsequent events are routed.
- All identifiers in a queue envelope are validated before database access.

## Testing strategy

### Domain and database

- Event, recipient, and outbox rows commit atomically with each business mutation.
- Rollback leaves no notification artifacts.
- Deterministic event keys prevent duplicates.
- Primary-event precedence prevents double QR/invoice/debt pushes.
- Zero debt delta creates no debt event.
- Recipient materialization follows direct and role routing.

### Queue contracts

- Every publisher implementation passes the same contract suite.
- QStash adapter maps the neutral envelope without adding business data.
- Signature verifier accepts current and next keys and rejects invalid, expired, and malformed requests.
- Disabled/missing provider configuration is surfaced explicitly.
- A fake provider proves business and worker tests have no QStash dependency.

### Worker and retry

- QStash redelivery does not resend a successful device delivery.
- Concurrent worker calls respect the lease.
- Quiet-hour events defer instead of disappearing.
- QR categories bypass quiet hours.
- Transient queue/FCM errors back off and recover.
- Permanent errors reach `dead` without an infinite retry loop.
- Invalid tokens are disabled safely.

### Business integration

- Completed sale creates `invoiceCreated`.
- Draft, quote, and booking creation does not create `invoiceCreated`.
- Received purchase creates `purchaseReceived`; draft purchase does not.
- Manual customer and supplier debt changes create one `debtChanged`.
- QR confirmation creates one `qrPaymentConfirmed` even when the webhook is replayed.
- Amount mismatch and other configured matching exceptions create one `qrPaymentException`.
- QR confirmation that also finalizes an invoice and changes debt creates only the QR primary event.

### Flutter

- New target/category allow-lists reject malformed messages.
- Foreground delivery waits for the explicit View action.
- Background and cold-start taps open the correct authenticated entity.
- Inaccessible entities fall back safely.
- Login-state and stale shared-terminal messages cannot leak into a later session.
- Vietnamese and English notification copy renders correctly.

### End-to-end

Test on physical Android and iOS devices:

- permission grant and denial;
- background, terminated, and foreground delivery;
- QR confirmation from a real signed test webhook;
- duplicate webhook replay;
- QStash retry after a controlled worker failure;
- APNs production/sandbox configuration;
- measured event-to-FCM acceptance latency;
- queue-provider outage followed by recovery publication.

## Rollout

1. Deploy schema and provider-neutral code with new categories disabled.
2. Configure Firebase, APNs, QStash, worker URL, signing keys, and recovery secret.
3. Enable QR confirmation for internal test accounts and verify p95 latency plus duplicate suppression.
4. Enable QR exceptions for owner/manager.
5. Enable invoice, purchase, and debt categories progressively.
6. Monitor retry age, dead letters, invalid tokens, and notification volume.
7. Retain the ability to disable each category and the push channel without disabling in-app events.

Rollback disables queue publication and new category switches while leaving immutable event/outbox rows available for diagnosis. It must not roll back completed sales, purchases, debt updates, or payments.

## External references

- [Upstash QStash getting started](https://upstash.com/docs/qstash/overall/getstarted)
- [Upstash QStash queues](https://upstash.com/docs/qstash/features/queues)
- [Firebase receive messages in Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages)
- [Firebase registration management](https://firebase.google.com/docs/cloud-messaging/manage-tokens)
- [Firebase FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes)
- [Firebase sending at scale and retry guidance](https://firebase.google.com/docs/cloud-messaging/scale-fcm)
- [Apple APNs notification requests and priorities](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)

## Non-goals

- Customer or supplier push applications.
- SMS, email, Zalo, or marketing campaigns.
- Replacing FCM/APNs.
- Guaranteed operating-system display within five seconds.
- Using queue payloads as business records.
- Sending raw transaction values on the lock screen.
- Reworking authentication, cashier quick switch, payment matching, inventory accounting, or debt calculation semantics.
- Adopting a queue provider directly inside business modules.

## Acceptance criteria

The design is complete when:

1. Each scoped business mutation creates its event, recipients, and outbox atomically.
2. Normal QR confirmation reaches successful FCM acceptance with p95 latency below five seconds in the defined healthy-provider test.
3. Webhook replay and queue redelivery cannot create a duplicate user-visible event or successful per-device delivery.
4. Queue provider code is isolated behind the documented interfaces and contract tests.
5. Switching queue providers requires a new publisher/verifier adapter plus configuration only; it does not require edits to business transactions, event storage, routing, FCM delivery, or Flutter.
6. QStash requests are signature-verified and secrets remain server-only.
7. Quiet hours defer routine events and never discard them; QR categories follow their bypass policy.
8. Notifications route only to intended active staff and preserve shared-terminal principal/effective-user isolation.
9. Lock-screen content contains no sensitive customer, supplier, debt, bank, or payment data.
10. Tapping a notification opens the correct authorized entity or a safe localized fallback.
11. Retry, dead-letter, recovery, and operational metrics are verified.
12. Focused backend, queue contract, business integration, Flutter, and physical-device tests pass.
