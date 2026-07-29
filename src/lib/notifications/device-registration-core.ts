import { and, eq, ne, or, sql } from "drizzle-orm";
import {
  mobilePushDeviceBindingFences,
  mobilePushDevices,
} from "@/db/schema";

// Drizzle's PostgreSQL and PGlite adapters share this transaction surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

type BindingDevice = {
  deviceId: string;
  platform: "android" | "ios";
  token: string;
  permission: "authorized" | "provisional";
  locale?: string;
  bindingGeneration: number;
};

type BindingMutationResult =
  | { kind: "registered" }
  | { kind: "deactivated" }
  | { kind: "stale" }
  | { kind: "busy"; retryAfterMs: number };

const retryableBindingMutationCodes = new Set([
  "23505", // concurrent unique device/token claim
  "40001", // serialization failure
  "40P01", // deadlock while two tokens/devices cross over
]);

class BindingBusyError extends Error {
  constructor(readonly result: BindingMutationResult) {
    super("DEVICE_BINDING_BUSY");
  }
}

async function runBindingMutation(
  database: DatabaseLike,
  mutation: (tx: DatabaseLike) => Promise<BindingMutationResult>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.transaction(mutation);
    } catch (error) {
      if (error instanceof BindingBusyError) {
        return error.result;
      }
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (
        !retryableBindingMutationCodes.has(code)
        || attempt === 2
      ) {
        throw error;
      }
    }
  }
  throw new Error("DEVICE_BINDING_RETRY_EXHAUSTED");
}

async function lockBindingFence(
  tx: DatabaseLike,
  input: {
    principalId: string;
    deviceId: string;
    bindingGeneration: number;
    active: boolean;
    now: Date;
  },
) {
  await tx
    .insert(mobilePushDeviceBindingFences)
    .values({
      userId: input.principalId,
      deviceId: input.deviceId,
      bindingGeneration: input.bindingGeneration,
      active: input.active,
      updatedAt: input.now,
    })
    .onConflictDoNothing();

  const [fence] = await tx
    .select()
    .from(mobilePushDeviceBindingFences)
    .where(and(
      eq(mobilePushDeviceBindingFences.userId, input.principalId),
      eq(mobilePushDeviceBindingFences.deviceId, input.deviceId),
    ))
    .limit(1)
    .for("update");

  if (fence.bindingGeneration > input.bindingGeneration) {
    return { kind: "stale" } as const;
  }
  if (
    input.active
    && fence.bindingGeneration === input.bindingGeneration
    && !fence.active
  ) {
    return { kind: "stale" } as const;
  }
  if (
    fence.bindingGeneration < input.bindingGeneration
    || fence.active !== input.active
  ) {
    await tx
      .update(mobilePushDeviceBindingFences)
      .set({
        bindingGeneration: input.bindingGeneration,
        active: input.active,
        updatedAt: input.now,
      })
      .where(and(
        eq(mobilePushDeviceBindingFences.userId, input.principalId),
        eq(mobilePushDeviceBindingFences.deviceId, input.deviceId),
      ));
  }
  return { kind: "accepted" } as const;
}

function activeLease(
  row: {
    sendLeaseId: string | null;
    sendLeaseExpiresAt: Date | null;
  },
  at: Date,
) {
  return Boolean(
    row.sendLeaseId
    && row.sendLeaseExpiresAt
    && row.sendLeaseExpiresAt.getTime() > at.getTime(),
  );
}

function busyResult(
  row: { sendLeaseExpiresAt: Date | null },
  at: Date,
): BindingMutationResult {
  return {
    kind: "busy",
    retryAfterMs: Math.max(
      0,
      (row.sendLeaseExpiresAt?.getTime() ?? at.getTime()) - at.getTime(),
    ),
  };
}

export async function registerPushDeviceBinding(
  database: DatabaseLike,
  input: {
    principalId: string;
    effectiveUserId: string;
    device: BindingDevice;
    now?: Date;
  },
): Promise<BindingMutationResult> {
  const mutationAt = input.now ?? new Date();
  return runBindingMutation(database, async (tx: DatabaseLike) => {
    const fence = await lockBindingFence(tx, {
      principalId: input.principalId,
      deviceId: input.device.deviceId,
      bindingGeneration: input.device.bindingGeneration,
      active: true,
      now: mutationAt,
    });
    if (fence.kind === "stale") return fence;

    const [existing] = await tx
      .select()
      .from(mobilePushDevices)
      .where(and(
        eq(mobilePushDevices.userId, input.principalId),
        eq(mobilePushDevices.deviceId, input.device.deviceId),
      ))
      .limit(1)
      .for("update");

    if (existing) {
      if (activeLease(existing, mutationAt)) {
        throw new BindingBusyError(busyResult(existing, mutationAt));
      }
      if (existing.bindingGeneration > input.device.bindingGeneration) {
        return { kind: "stale" };
      }
      if (
        existing.bindingGeneration === input.device.bindingGeneration
        && (
          existing.effectiveUserId !== input.effectiveUserId
          || existing.token !== input.device.token
          || existing.platform !== input.device.platform
          || existing.permission !== input.device.permission
          || (existing.locale ?? undefined) !== input.device.locale
        )
      ) {
        return { kind: "stale" };
      }
    }

    const [tokenOwner] = await tx
      .select()
      .from(mobilePushDevices)
      .where(and(
        eq(mobilePushDevices.token, input.device.token),
        existing ? ne(mobilePushDevices.id, existing.id) : undefined,
      ))
      .limit(1)
      .for("update");
    if (tokenOwner && activeLease(tokenOwner, mutationAt)) {
      throw new BindingBusyError(busyResult(tokenOwner, mutationAt));
    }
    if (tokenOwner) {
      await tx.delete(mobilePushDevices).where(eq(mobilePushDevices.id, tokenOwner.id));
    }

    if (existing) {
      await tx
        .update(mobilePushDevices)
        .set({
          effectiveUserId: input.effectiveUserId,
          token: input.device.token,
          platform: input.device.platform,
          permission: input.device.permission,
          locale: input.device.locale,
          bindingGeneration: input.device.bindingGeneration,
          sendLeaseId: null,
          sendLeaseGeneration: null,
          sendLeaseExpiresAt: null,
          enabled: true,
          lastSeenAt: mutationAt,
          updatedAt: mutationAt,
        })
        .where(eq(mobilePushDevices.id, existing.id));
    } else {
      await tx.insert(mobilePushDevices).values({
        userId: input.principalId,
        effectiveUserId: input.effectiveUserId,
        ...input.device,
        enabled: true,
        lastSeenAt: mutationAt,
        updatedAt: mutationAt,
      });
    }
    return { kind: "registered" };
  });
}

export async function deactivatePushDeviceBinding(
  database: DatabaseLike,
  input: {
    principalId: string;
    deviceId: string;
    bindingGeneration: number;
    now?: Date;
  },
): Promise<BindingMutationResult> {
  const mutationAt = input.now ?? new Date();
  return runBindingMutation(database, async (tx: DatabaseLike) => {
    const fence = await lockBindingFence(tx, {
      principalId: input.principalId,
      deviceId: input.deviceId,
      bindingGeneration: input.bindingGeneration,
      active: false,
      now: mutationAt,
    });
    if (fence.kind === "stale") return fence;

    const [existing] = await tx
      .select()
      .from(mobilePushDevices)
      .where(and(
        eq(mobilePushDevices.userId, input.principalId),
        eq(mobilePushDevices.deviceId, input.deviceId),
      ))
      .limit(1)
      .for("update");
    if (!existing) return { kind: "deactivated" };
    if (activeLease(existing, mutationAt)) {
      throw new BindingBusyError(busyResult(existing, mutationAt));
    }
    if (existing.bindingGeneration > input.bindingGeneration) {
      return { kind: "stale" };
    }

    await tx
      .update(mobilePushDevices)
      .set({
        bindingGeneration: input.bindingGeneration,
        enabled: false,
        sendLeaseId: null,
        sendLeaseGeneration: null,
        sendLeaseExpiresAt: null,
        updatedAt: mutationAt,
      })
      .where(and(
        eq(mobilePushDevices.id, existing.id),
        or(
          eq(mobilePushDevices.bindingGeneration, existing.bindingGeneration),
          sql`${mobilePushDevices.bindingGeneration} < ${input.bindingGeneration}`,
        ),
      ));
    return { kind: "deactivated" };
  });
}
