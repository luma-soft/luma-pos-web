import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { mobilePushDeliveries } from "@/db/schema";

type PushDatabase = NodePgDatabase<typeof schema>;

// FCM gets four minutes of a five-minute claim. The remaining 60 seconds,
// twice the validated 30-second minimum margin, is reserved for abort
// propagation, sender settlement, and the token-fenced acknowledgement.
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_SEND_TIMEOUT_MS = 4 * 60_000;
const DEFAULT_SAFETY_MARGIN_MS = 30_000;

function settleBefore<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<
    { settled: true; value: T } | { settled: false }
  >((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve({ settled: true, value });
    });
  });
}

export async function claimPushDeliveryCore(
  database: PushDatabase,
  input: {
    deviceId: string;
    notificationKey: string;
    now?: Date;
    leaseMs?: number;
  },
) {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (input.leaseMs ?? 5 * 60_000));
  const claimToken = randomUUID();
  const result = await database.execute(sql`
    insert into ${mobilePushDeliveries} (
      "device_id", "notification_key", "status", "attempts",
      "attempted_at", "claim_token", "claimed_at"
    ) values (
      ${input.deviceId}, ${input.notificationKey}, 'sending', 1,
      ${now}, ${claimToken}, ${now}
    )
    on conflict ("device_id", "notification_key")
    do update set
      "status" = 'sending',
      "attempts" = ${mobilePushDeliveries.attempts} + 1,
      "attempted_at" = ${now},
      "claim_token" = ${claimToken},
      "claimed_at" = ${now},
      "error_code" = null
    where ${mobilePushDeliveries.status} <> 'sent'
      and (
        ${mobilePushDeliveries.claimedAt} is null
        or ${mobilePushDeliveries.claimedAt} < ${staleBefore}
      )
    returning "claim_token"
  `);
  const claimed = result.rows[0] as { claim_token?: string } | undefined;
  return claimed?.claim_token === claimToken ? claimToken : null;
}

export async function acknowledgePushDeliveryCore(
  database: PushDatabase,
  input: {
    deviceId: string;
    notificationKey: string;
    claimToken: string;
    status: "sent" | "failed";
    errorCode?: string | null;
    now?: Date;
  },
) {
  const [updated] = await database.update(mobilePushDeliveries).set({
    status: input.status,
    errorCode: input.errorCode ?? null,
    attemptedAt: input.now ?? new Date(),
    claimToken: null,
    claimedAt: null,
  }).where(and(
    eq(mobilePushDeliveries.deviceId, input.deviceId),
    eq(mobilePushDeliveries.notificationKey, input.notificationKey),
    eq(mobilePushDeliveries.claimToken, input.claimToken),
    eq(mobilePushDeliveries.status, "sending"),
  )).returning({ status: mobilePushDeliveries.status });
  return updated?.status === input.status;
}

async function renewPushDeliveryClaimCore(
  database: PushDatabase,
  input: {
    deviceId: string;
    notificationKey: string;
    claimToken: string;
    now?: Date;
  },
) {
  const [updated] = await database.update(mobilePushDeliveries).set({
    claimedAt: input.now ?? new Date(),
  }).where(and(
    eq(mobilePushDeliveries.deviceId, input.deviceId),
    eq(mobilePushDeliveries.notificationKey, input.notificationKey),
    eq(mobilePushDeliveries.claimToken, input.claimToken),
    eq(mobilePushDeliveries.status, "sending"),
  )).returning({ id: mobilePushDeliveries.id });
  return Boolean(updated);
}

export async function deliverPushDeviceCore(
  database: PushDatabase,
  input: {
    deviceId: string;
    notificationKey: string;
    leaseMs?: number;
    sendTimeoutMs?: number;
    safetyMarginMs?: number;
    send: (signal: AbortSignal) => Promise<{
      ok: boolean;
      errorCode?: string | null;
    }>;
  },
) {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  const sendTimeoutMs = input.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const safetyMarginMs = input.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS;
  if (
    leaseMs <= 0
    || sendTimeoutMs <= 0
    || safetyMarginMs <= 0
    || sendTimeoutMs + safetyMarginMs >= leaseMs
  ) {
    throw new Error("PUSH_DELIVERY_TIMEOUT_CONFIG_INVALID");
  }
  const claimToken = await claimPushDeliveryCore(database, {
    ...input,
    leaseMs,
  });
  if (!claimToken) return { outcome: "skipped" as const };

  const controller = new AbortController();
  const sendResult = Promise.resolve()
    .then(() => input.send(controller.signal))
    .then(
      (value) => value,
      () => ({ ok: false, errorCode: "FCM_NETWORK" }),
    );
  const initial = await settleBefore(sendResult, sendTimeoutMs);
  let delivery: { ok: boolean; errorCode?: string | null };
  if (initial.settled) {
    delivery = initial.value;
  } else {
    controller.abort(new Error("PUSH_DELIVERY_SEND_TIMEOUT"));
    const heartbeatMs = Math.max(
      1,
      Math.min(Math.floor(safetyMarginMs / 2), Math.floor(leaseMs / 3)),
    );
    let lateDelivery: { ok: boolean; errorCode?: string | null } | null = null;
    for (;;) {
      const settled = await settleBefore(sendResult, heartbeatMs);
      if (settled.settled) {
        lateDelivery = settled.value;
        break;
      }
      const renewed = await renewPushDeliveryClaimCore(database, {
        deviceId: input.deviceId,
        notificationKey: input.notificationKey,
        claimToken,
      });
      if (!renewed) {
        await sendResult;
        return { outcome: "failed" as const, errorCode: "CLAIM_LOST" };
      }
    }
    delivery = lateDelivery ?? { ok: false, errorCode: "FCM_TIMEOUT" };
  }
  const acknowledged = await acknowledgePushDeliveryCore(database, {
    ...input,
    claimToken,
    status: delivery.ok ? "sent" : "failed",
    errorCode: delivery.errorCode,
  });
  return {
    outcome: delivery.ok && acknowledged ? "sent" as const : "failed" as const,
    errorCode: delivery.errorCode ?? null,
  };
}
