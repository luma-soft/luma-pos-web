import { strict as assert } from "node:assert";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ??= "postgres://release-test:release-test@127.0.0.1/release-test";
const operations = await import(
  `${projectRoot}/src/app/api/cron/notifications/route.ts`
);

assert.equal(
  typeof operations.getNotificationOperationsSummary,
  "function",
  "the protected cron must expose a privacy-safe operations projection",
);

const client = new PGlite();
const database = drizzle(client);
await client.exec(`
  CREATE TABLE notification_outbox (
    id uuid PRIMARY KEY,
    status varchar(20) NOT NULL,
    available_at timestamptz NOT NULL
  );
  CREATE TABLE notification_events (
    id uuid PRIMARY KEY,
    category varchar(40) NOT NULL,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE mobile_push_deliveries (
    id uuid PRIMARY KEY,
    notification_key varchar(180) NOT NULL,
    status varchar(20) NOT NULL,
    attempted_at timestamptz NOT NULL
  );

  INSERT INTO notification_outbox VALUES
    ('10000000-0000-4000-8000-000000000001', 'pending', '2026-07-29T11:58:00Z'),
    ('10000000-0000-4000-8000-000000000002', 'pending', '2026-07-29T12:05:00Z'),
    ('10000000-0000-4000-8000-000000000003', 'retry',   '2026-07-29T11:50:00Z'),
    ('10000000-0000-4000-8000-000000000004', 'dead',    '2026-07-29T11:45:00Z'),
    ('10000000-0000-4000-8000-000000000005', 'completed','2026-07-29T11:40:00Z');

  INSERT INTO notification_events VALUES
    ('20000000-0000-4000-8000-000000000001', 'qrPaymentConfirmed', '2026-07-29T11:59:55Z'),
    ('20000000-0000-4000-8000-000000000002', 'qrPaymentException', '2026-07-29T11:59:50Z'),
    ('20000000-0000-4000-8000-000000000003', 'invoiceCreated', '2026-07-29T11:59:40Z'),
    ('20000000-0000-4000-8000-000000000004', 'qrPaymentConfirmed', '2026-07-29T10:30:00Z');

  INSERT INTO mobile_push_deliveries VALUES
    ('30000000-0000-4000-8000-000000000001', 'event:20000000-0000-4000-8000-000000000001', 'sent', '2026-07-29T11:59:58Z'),
    ('30000000-0000-4000-8000-000000000002', 'event:20000000-0000-4000-8000-000000000001', 'sent', '2026-07-29T11:59:59Z'),
    ('30000000-0000-4000-8000-000000000003', 'event:20000000-0000-4000-8000-000000000002', 'sent', '2026-07-29T11:59:55Z'),
    ('30000000-0000-4000-8000-000000000004', 'event:20000000-0000-4000-8000-000000000003', 'failed', '2026-07-29T11:59:45Z'),
    ('30000000-0000-4000-8000-000000000005', 'event:20000000-0000-4000-8000-000000000003', 'failed', '2026-07-29T11:59:46Z'),
    ('30000000-0000-4000-8000-000000000006', 'event:20000000-0000-4000-8000-000000000004', 'sent', '2026-07-29T10:30:04Z');
`);

const now = new Date("2026-07-29T12:00:00.000Z");
const summary = await operations.getNotificationOperationsSummary(database, now);

assert.deepEqual(summary, {
  pending: 2,
  retry: 1,
  dead: 1,
  oldestDueAgeSeconds: 600,
  fcmAcceptedLastHour: 3,
  fcmFailedLastHour: 2,
  qrP95FcmAcceptedMs: 4900,
});

await client.exec(`
  DELETE FROM mobile_push_deliveries;
  DELETE FROM notification_events;
`);
const withoutSamples = await operations.getNotificationOperationsSummary(
  database,
  now,
);
assert.equal(withoutSamples.qrP95FcmAcceptedMs, null);

console.log("✅ notification operations summary is bounded and privacy-safe");
