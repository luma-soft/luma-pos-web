# Internal push operations runbook

This runbook covers the provider-neutral notification outbox, the current
QStash transport, Firebase Cloud Messaging (FCM), APNs, recovery, rollback,
and release evidence. It does not authorize exposing credentials or payment
data.

## Security and evidence rules

- Keep `QSTASH_TOKEN`, both QStash signing keys,
  `FIREBASE_SERVICE_ACCOUNT_JSON`, and `CRON_SECRET` in the
  deployment secret store. Never print their values.
- Never copy an authorization header, raw webhook body, device token, service
  account JSON, payment amount, event metadata, or payment-partner identity
  into logs, screenshots, tickets, metrics, or this evidence pack.
- Queue bodies contain only `version`, `eventId`, `deduplicationKey`, and
  `queuedAt`. Push data contains only the allow-listed event/category/target
  identifiers required for exact-entity navigation.
- Record timestamps, bounded status counts, opaque event IDs when access is
  restricted, and pass/fail results. Redact screenshots before attaching them.
- Both notification cron routes remain protected by
  `Authorization: Bearer <CRON_SECRET>`. Vercel injects this header for
  configured cron invocations. Do not place the bearer
  value in a shell history, command transcript, or monitoring URL.

## Production configuration

Set these server-side values:

```text
NOTIFICATION_QUEUE_PROVIDER=qstash
NOTIFICATION_QUEUE_WORKER_URL=https://<deployment>/api/workers/notifications/push
QSTASH_TOKEN=<secret-store reference>
QSTASH_CURRENT_SIGNING_KEY=<secret-store reference>
QSTASH_NEXT_SIGNING_KEY=<secret-store reference>
FIREBASE_SERVICE_ACCOUNT_JSON=<secret-store reference>
CRON_SECRET=<secret-store reference>
```

The release preflight requires all values, requires the provider to equal
`qstash`, and rejects a non-public or non-HTTPS worker URL. Generate the
value-free checklist from the mobile repository:

```sh
dart run tool/release_preflight.dart --template
dart run tool/release_preflight.dart
```

The second command is expected to exit `2` until all release-owned inputs,
signing evidence, and attestations exist. Its output contains issue codes, not
secret values.

`NOTIFICATION_CRON_SECRET` is accepted only when it is explicitly configured
for a legacy caller during migration. The route compares every configured
candidate in constant time. New deployments must use `CRON_SECRET`; remove
the legacy value after all non-Vercel callers have rotated.

## QStash setup and safe rotation

Initial setup:

1. Create or select the production QStash project under the production
   infrastructure owner.
2. Put the publish token, current signing key, and next signing key into the
   deployment secret store. Reference them from the server deployment; do not
   copy them into mobile configuration.
3. Set the public worker URL to
   `https://<deployment>/api/workers/notifications/push`.
4. Do not configure QStash provider deduplication for outbox publications.
   The immutable event key and delivery rows are the application idempotency
   boundary; recovery, retry, and authorized replay must each be able to
   create a fresh provider message.
5. Deploy, then publish one non-sensitive test event through the application.
   Confirm a QStash `2xx`, one completed outbox row, and one successful FCM
   delivery. Record only timestamps and bounded result codes.

Token rotation:

1. Create the replacement publish token in QStash without revoking the active
   token.
2. Update `QSTASH_TOKEN` in the secret store and deploy.
3. Confirm new publication and worker processing. Confirm the protected
   operations summary remains healthy.
4. Revoke the old token only after the new deployment is proven. If
   publication fails, restore the previous secret-store version and run
   recovery after service returns.

Signing-key rotation:

1. Keep the deployed current key valid and put the provider's advertised next
   key in `QSTASH_NEXT_SIGNING_KEY`.
2. Deploy both verifier keys before promoting/rotating keys in QStash.
3. Perform the provider rotation, then verify a newly signed delivery reaches
   the worker with `2xx`.
4. Update the deployed current/next pair to the new values and verify again
   before retiring the former current key. Roll back the secret-store version
   if signatures are rejected.

Never rotate the publish token and signing-key pair in the same unverified
step. That preserves a known-good rollback boundary.

## Worker URL verification

1. Confirm DNS and TLS validation from outside the private network.
2. Confirm the path is exactly `/api/workers/notifications/push`.
3. An unsigned request must return `401`; a signed malformed message must
   return a bounded `400`; neither response may echo the body or signature.
4. A valid signed queue message normally returns `2xx`. A delivery that races
   ahead of the publisher's final `published` transition returns `409`, which
   instructs QStash to retry; it must not acknowledge and strand the event.
   Confirm the matching outbox transitions and delivery counters instead of
   logging the request body.
5. Confirm `GET /api/cron/notifications` with no/incorrect bearer returns
   `401`. Authorization behavior must not be weakened to expose metrics.

## Firebase and APNs readiness

1. Validate that the Firebase service account belongs to the production
   Firebase project and can call FCM v1. Keep the JSON only in the server
   secret store.
2. Build Android with the production Firebase dart-defines and release
   signing. Install it on one physical Android device.
3. Upload the production APNs authentication key to the same Firebase project,
   verify bundle ID/environment alignment, build with production provisioning,
   and install on one physical iPhone.
4. On each device, grant notification permission, authenticate, and confirm
   registration without displaying or recording the token.
5. Verify foreground `View`, background navigation, and terminated-app
   navigation resolve the exact entity. Verify a cashier switch on a shared
   terminal cannot resolve the previous cashier's event.

Each device send acquires a short database lease tied to the device, token,
principal, effective actor, and binding generation. Rebinding returns a
retryable conflict while that lease is active. Android `collapse_key` and APNs
`apns-collapse-id` remain stable for the same event/device delivery.

There is one unavoidable provider boundary: if the worker crashes or loses its
connection after FCM accepted a request but before the response is persisted,
the server cannot prove whether FCM accepted it. Recovery waits for the bounded
lease and retries with the same collapse identity. Treat this as
response-unknown recovery rather than claiming physical exactly-once delivery;
never clear the lease early or invent provider evidence.

## Protected operational summary

An authorized `GET /api/cron/notifications` response includes only these
operational fields alongside its existing evaluation counts:

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

Semantics:

- `pending`, `retry`, and `dead` count exact outbox statuses.
- `oldestDueAgeSeconds` is the age of the oldest `pending`/`retry` row whose
  `available_at` is due; it is `0` when none is due.
- `fcmAcceptedLastHour` counts device-delivery rows whose latest result is
  accepted and whose persisted FCM response timestamp is in the closed
  one-hour window ending at evaluation time.
- `fcmFailedLastHour` counts device-delivery rows whose latest result is failed
  in the same window. It is not a raw provider-attempt history.
- `qrP95FcmAcceptedMs` uses QR events created in the same one-hour window. For
  each event it takes the first successful FCM acceptance, calculates
  `notification_events.created_at -> first acceptance`, then returns the
  continuous p95 rounded to milliseconds. It is `null` when there is no
  healthy QR sample.

The queries are bounded by status/time indexes and the one-hour QR window.
Metrics never project event metadata, entity IDs, device IDs/tokens, amounts,
or identities. Operational p95 is a health signal; the release SLA is accepted
only from the physical-device SIT set of at least twenty healthy QR samples.

Alert policy:

- Evaluate the protected summary once per minute without logging its bearer.
- Warn when `oldestDueAgeSeconds > 120` for two consecutive evaluations.
- Page the notification on-call when it exceeds `300`, continues increasing
  across three evaluations, or any `dead` row appears.
- After recovery, close the alert only when `oldestDueAgeSeconds` returns to
  `0` and `retry` is no longer increasing. Record counts and timestamps only.

Latency interpretation:

- Event-to-queue:
  `notification_events.created_at -> notification_outbox.published_at`.
- Queue-to-worker:
  `notification_outbox.published_at -> notification_outbox.first_attempt_at`.
- Event-to-FCM:
  `notification_events.created_at -> min(mobile_push_deliveries.attempted_at
  where status = 'sent')`.

The SLA is event-to-first-successful-FCM acceptance, not queue publication,
worker start, outbox completion, or device display time.

## Dead-event replay through the application

Do not update outbox rows directly.

1. An authenticated active manager or owner identifies the dead event in the
   restricted operations surface.
2. Invoke the application server action
   `republishDeadNotificationForUser(authenticatedUserId, eventId)` from
   `src/lib/actions/notification-operations.ts`.
3. The action rechecks manager authority, accepts only a UUID event ID, resets
   only a `dead` outbox row, preserves the immutable event and delivery
   deduplication rows, and republishes through the configured queue contract.
4. Confirm the result is successful, status leaves `dead`, and already
   successful device/event pairs are not sent again. Record the status and
   timestamps only.

`forbidden`, `conflict`, and `serverError` are stop conditions. Never bypass
them with SQL.

## Queue outage recovery

The deployment schedule invokes
`/api/cron/notifications/outbox` once per minute. The route remains
bearer-protected and processes at most 50 rows per run. Manual invocations
below are for incident acceleration and verification, not the normal trigger.

1. Confirm whether publication or signed delivery is failing using bounded
   status counts and provider health; do not enable request-body logging.
2. If needed, stop new publication by removing/invalidating
   `NOTIFICATION_QUEUE_PROVIDER` in the server deployment and redeploying.
   Business transactions continue to commit their immutable event and outbox
   rows; publication fails closed into recoverable work.
3. Restore the provider configuration and verify one signed test delivery.
4. Invoke protected `GET /api/cron/notifications/outbox` with the cron bearer
   if an immediate run is needed. Each run republishes at most 50 due rows and
   returns only `{ recovered }`. It also recovers a `published` publication
   whose worker callback was lost after the bounded two-minute orphan window.
5. Repeat bounded recovery invocations while `oldestDueAgeSeconds` falls.
   Investigate rather than looping if `retry`/`dead` rises.
6. Replay dead events individually through the manager/owner application
   action after fixing the root cause.

## Provider replacement

Business code must remain provider-neutral.

1. Implement `NotificationQueuePublisher` and
   `NotificationQueueRequestVerifier` from
   `src/lib/notifications/contracts.ts` in a new provider adapter.
2. Keep the same strict `NotificationQueueMessageV1` allow-list and reduce
   provider errors to bounded operational classes.
3. Add publisher/verifier contract tests, including invalid signature,
   malformed/extra fields, deduplication, retry, and secret-redaction cases.
4. Add provider selection in `src/lib/notifications/queue/config.ts`; do not
   import a provider SDK from business, route, outbox, or metrics code.
5. Run the full backend verification and physical-device SIT before switching
   production configuration.

The QStash SDK is imported only by
`src/lib/notifications/queue/qstash.ts`. Replacing QStash means changing the
adapter/configuration behind the two contracts, not the event/outbox model.

## Rollback without reverting business data

1. Disable any affected category independently in store notification settings:
   `invoiceCreated`, `purchaseReceived`, `debtChanged`,
   `qrPaymentConfirmed`, or `qrPaymentException`.
2. To stop all new queue publication, remove/invalidly set
   `NOTIFICATION_QUEUE_PROVIDER` and deploy. Do not delete events, recipients,
   outbox rows, or business records.
3. Existing signed provider deliveries may still arrive. Keep worker signature
   verification enabled; category and live recipient/channel checks remain
   fail-closed.
4. Fix or roll back application code/configuration. Re-enable categories only
   after verification.
5. Restore queue configuration and invoke bounded outbox recovery. Replay
   individual dead events through the authorized action.

## Physical-device SIT checklist

Run only when a production-like database, QStash, FCM/APNs, one physical
Android device, and one physical iPhone are all available.

- [ ] Grant notification permission and register both devices.
- [ ] Confirm a signed QR test payment through the approved SIT environment.
- [ ] Capture event `created_at`, queue publication, worker first-attempt, and
      first successful FCM acceptance timestamps.
- [ ] Replay the webhook; confirm no second visible event or successful
      device/event delivery.
- [ ] Force one worker `500`; observe QStash retry, then allow success.
- [ ] Disable queue publication, create an event, restore publication, run
      recovery, and confirm delivery.
- [ ] Verify Android and iPhone foreground `View` behavior.
- [ ] Verify background/terminated exact-entity navigation on both platforms.
- [ ] Switch cashier on a shared terminal; confirm the previous cashier's
      event cannot resolve.
- [ ] Confirm duplicate successful deliveries per device equals `0`.
- [ ] Record at least twenty healthy QR samples and independently calculate
      p95. Pass only when p95 is below `5000 ms`.

Evidence header:

```text
Environment:
Build/commit:
Android model / OS:
iPhone model / iOS:
QStash project evidence reference (no credentials):
Firebase/APNs evidence reference (no credentials):
Database evidence reference (restricted):
Operator:
Start/end time:
```

Healthy QR sample table (leave blank until observed):

| # | Event created (UTC) | Queue published (UTC) | Worker first attempt (UTC) | First FCM acceptance (UTC) | Event-to-FCM ms | Duplicate successes/device |
| -: | --- | --- | --- | --- | ---: | ---: |
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |

```text
Healthy sample count:
p95 event-to-first-FCM acceptance:
Duplicate successful deliveries per device:
Android foreground/background/terminated:
iPhone foreground/background/terminated:
Shared-terminal isolation:
Forced-500 retry:
Publication-disable/recovery:
Dead replay (if exercised):
Result: PASS / FAIL / NOT RUN
Blocker (required when NOT RUN):
```
