import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("push delivery PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    mobilePushDeliveries,
    mobilePushDevices,
    profiles,
  } = schema;
  const {
    acknowledgePushDeliveryCore,
    deliverPushDeviceCore,
  } = await import(`${projectRoot}/src/lib/notifications/push-delivery.ts`);
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const profileId = randomUUID();
  const notificationKey = `push-race:${randomUUID()}`;
  let deviceId;
  let sends = 0;
  try {
    await db.insert(profiles).values({
      id: profileId,
      fullName: notificationKey,
      role: "technician",
    });
    const [device] = await db.insert(mobilePushDevices).values({
      userId: profileId,
      effectiveUserId: profileId,
      deviceId: `device-${randomUUID()}`,
      platform: "android",
      token: `token-${randomUUID()}`,
    }).returning();
    deviceId = device.id;
    const send = async () => {
      sends += 1;
      await delay(150);
      return { ok: true };
    };
    const outcomes = await Promise.all([
      deliverPushDeviceCore(drizzle(clientA, { schema }), {
        deviceId,
        notificationKey,
        send,
      }),
      deliverPushDeviceCore(drizzle(clientB, { schema }), {
        deviceId,
        notificationKey,
        send,
      }),
    ]);
    assert.equal(sends, 1, "concurrent delivery dispatched FCM more than once");
    assert.deepEqual(
      outcomes.map((item) => item.outcome).sort(),
      ["sent", "skipped"],
    );
    const staleFailureAcknowledged = await acknowledgePushDeliveryCore(db, {
      deviceId,
      notificationKey,
      claimToken: randomUUID(),
      status: "failed",
      errorCode: "STALE_FAILURE",
    });
    assert.equal(staleFailureAcknowledged, false);
    const [persisted] = await db.select({
      status: mobilePushDeliveries.status,
      errorCode: mobilePushDeliveries.errorCode,
    }).from(mobilePushDeliveries).where(and(
      eq(mobilePushDeliveries.deviceId, deviceId),
      eq(mobilePushDeliveries.notificationKey, notificationKey),
    ));
    assert.deepEqual(persisted, { status: "sent", errorCode: null });
    const retryKey = `push-retry:${randomUUID()}`;
    assert.equal((await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: retryKey,
      send: async () => ({ ok: false, errorCode: "FCM_503" }),
    })).outcome, "failed");
    assert.equal((await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: retryKey,
      send: async () => ({ ok: true }),
    })).outcome, "sent");
    console.log("push delivery PostgreSQL concurrency: one send and terminal success verified");
  } finally {
    if (deviceId) {
      await db.delete(mobilePushDevices).where(eq(mobilePushDevices.id, deviceId));
    }
    await db.delete(profiles).where(eq(profiles.id, profileId));
    clientA.release();
    clientB.release();
    await pool.end();
  }
}
