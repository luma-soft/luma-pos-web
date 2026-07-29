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

    const timeoutKey = `push-timeout:${randomUUID()}`;
    let abortObserved = false;
    const timedOut = await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: timeoutKey,
      leaseMs: 500,
      sendTimeoutMs: 100,
      safetyMarginMs: 100,
      send: (signal) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          abortObserved = true;
          setTimeout(() => reject(new Error("ABORTED")), 25);
        }, { once: true });
      }),
    });
    assert.equal(abortObserved, true, "timed-out sender did not receive abort");
    assert.equal(timedOut.outcome, "failed");
    assert.equal((await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: timeoutKey,
      send: async () => ({ ok: true }),
    })).outcome, "sent");

    await assert.rejects(
      deliverPushDeviceCore(db, {
        deviceId,
        notificationKey: `push-invalid-timeout:${randomUUID()}`,
        leaseMs: 100,
        sendTimeoutMs: 80,
        safetyMarginMs: 20,
        send: async () => ({ ok: true }),
      }),
      /PUSH_DELIVERY_TIMEOUT_CONFIG_INVALID/,
    );

    const nonCooperativeKey = `push-noncooperative:${randomUUID()}`;
    let settleNonCooperative;
    let overlappingSendCalls = 0;
    const heldDelivery = deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: nonCooperativeKey,
      leaseMs: 400,
      sendTimeoutMs: 80,
      safetyMarginMs: 80,
      send: () => new Promise((resolve) => {
        settleNonCooperative = resolve;
      }),
    });
    await delay(500);
    const overlap = await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: nonCooperativeKey,
      leaseMs: 400,
      sendTimeoutMs: 80,
      safetyMarginMs: 80,
      send: async () => {
        overlappingSendCalls += 1;
        return { ok: true };
      },
    });
    assert.equal(overlap.outcome, "skipped");
    assert.equal(overlappingSendCalls, 0);
    settleNonCooperative({ ok: true });
    assert.equal((await heldDelivery).outcome, "failed");
    assert.equal((await deliverPushDeviceCore(db, {
      deviceId,
      notificationKey: nonCooperativeKey,
      leaseMs: 400,
      sendTimeoutMs: 80,
      safetyMarginMs: 80,
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
