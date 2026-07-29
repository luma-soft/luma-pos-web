import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { mobilePushDeliveries } from "@/db/schema";

type PushDatabase = NodePgDatabase<typeof schema>;

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

export async function deliverPushDeviceCore(
  database: PushDatabase,
  input: {
    deviceId: string;
    notificationKey: string;
    send: () => Promise<{ ok: boolean; errorCode?: string | null }>;
  },
) {
  const claimToken = await claimPushDeliveryCore(database, input);
  if (!claimToken) return { outcome: "skipped" as const };
  let delivery: { ok: boolean; errorCode?: string | null };
  try {
    delivery = await input.send();
  } catch {
    delivery = { ok: false, errorCode: "FCM_NETWORK" };
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
