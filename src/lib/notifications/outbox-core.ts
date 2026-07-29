import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  mobilePushDeliveries,
  mobilePushDevices,
  notificationEvents,
  notificationOutbox,
  notificationRecipients,
  profiles,
  storeSettings,
} from "@/db/schema";
import type { ActionResult, Role } from "@/lib/actions/common";
import {
  notificationCategories,
  type NotificationCategory,
  type NotificationQueueMessageV1,
  type NotificationQueuePublisher,
  type NotificationTarget,
} from "@/lib/notifications/contracts";
import type {
  DeviceNotificationInput,
  DeviceNotificationResult,
} from "@/lib/notifications/push";
import { isWithinQuietHours } from "@/lib/notifications/policy";
import { parseStorePrefs } from "@/lib/schemas/settings";

// Drizzle's production PostgreSQL and PGlite test runtimes expose the same
// fluent operations with different generic brands.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

export type NotificationDeviceSender = (
  input: DeviceNotificationInput,
) => Promise<DeviceNotificationResult>;

type NotificationOutboxCoreOptions = {
  database: DatabaseLike;
  publisher: NotificationQueuePublisher;
  sender: NotificationDeviceSender;
  now?: () => Date;
  jitter?: () => number;
  provider?: string;
};

const publishLeaseMs = 30_000;
const processingLeaseMs = 2 * 60_000;
const deviceSendLeaseMs = processingLeaseMs + 60_000;
const maxAttemptAgeMs = 60 * 60_000;
const maxAttempts = 10;

function boundedErrorCode(value: unknown, fallback: string): string {
  if (
    typeof value === "string"
    && /^(?:FCM|QUEUE|NOTIFICATION)_[A-Z0-9_]{1,67}$/.test(value)
  ) {
    return value.slice(0, 80);
  }
  return fallback;
}

function addMilliseconds(value: Date, milliseconds: number) {
  return new Date(value.getTime() + milliseconds);
}

function retryDate(
  now: Date,
  attempt: number,
  jitter: () => number,
  minimumMs = 0,
) {
  const exponentialMs = Math.min(15 * 60_000, 60_000 * (2 ** Math.max(0, attempt - 1)));
  const baseMs = Math.max(minimumMs, exponentialMs);
  const jitterMs = Math.floor(Math.max(0, Math.min(1, jitter())) * Math.min(30_000, baseMs / 4));
  return addMilliseconds(now, baseMs + jitterMs);
}

function quietHoursEnd(now: Date, quietHours: {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
}) {
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let minute = 0; minute < 48 * 60; minute += 1) {
    if (!isWithinQuietHours({ now: candidate, ...quietHours })) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return addMilliseconds(now, 24 * 60 * 60_000);
}

function notificationQueueMessage(eventId: string, now: Date): NotificationQueueMessageV1 {
  return {
    version: 1,
    eventId,
    deduplicationKey: `notification:${eventId}`,
    queuedAt: now.toISOString(),
  };
}

function isNotificationCategory(value: string): value is NotificationCategory {
  return (notificationCategories as readonly string[]).includes(value);
}

export function createNotificationOutboxCore(options: NotificationOutboxCoreOptions) {
  const {
    database,
    publisher,
    sender,
    now = () => new Date(),
    jitter = Math.random,
    provider = "queue",
  } = options;

  async function publishCommittedNotification(eventId: string): Promise<boolean> {
    const claimedAt = now();
    const [claim] = await database
      .update(notificationOutbox)
      .set({
        status: "publishing",
        leaseExpiresAt: addMilliseconds(claimedAt, publishLeaseMs),
        updatedAt: claimedAt,
      })
      .where(and(
        eq(notificationOutbox.eventId, eventId),
        lte(notificationOutbox.availableAt, claimedAt),
        or(
          inArray(notificationOutbox.status, ["pending", "retry"]),
          and(
            eq(notificationOutbox.status, "publishing"),
            lte(notificationOutbox.leaseExpiresAt, claimedAt),
          ),
        ),
      ))
      .returning({
        id: notificationOutbox.id,
        leaseExpiresAt: notificationOutbox.leaseExpiresAt,
      });

    if (!claim) return false;

    try {
      const result = await publisher.publish(notificationQueueMessage(eventId, claimedAt));
      const [published] = await database
        .update(notificationOutbox)
        .set({
          status: "published",
          provider,
          providerMessageId: result.providerMessageId.slice(0, 180),
          leaseExpiresAt: null,
          lastErrorCode: null,
          publishedAt: now(),
          updatedAt: now(),
        })
        .where(and(
          eq(notificationOutbox.id, claim.id),
          eq(notificationOutbox.status, "publishing"),
          eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
        ))
        .returning({ id: notificationOutbox.id });
      return Boolean(published);
    } catch {
      const failedAt = now();
      await database
        .update(notificationOutbox)
        .set({
          status: "retry",
          availableAt: retryDate(failedAt, 1, jitter),
          leaseExpiresAt: null,
          lastErrorCode: "QUEUE_PUBLISH_FAILED",
          updatedAt: failedAt,
        })
        .where(and(
          eq(notificationOutbox.id, claim.id),
          eq(notificationOutbox.status, "publishing"),
          eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
        ));
      return false;
    }
  }

  async function recoverDueNotifications(limit = 50): Promise<number> {
    const recoveryAt = now();
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));

    await database
      .update(notificationOutbox)
      .set({
        status: "retry",
        availableAt: recoveryAt,
        leaseExpiresAt: null,
        lastErrorCode: "LEASE_EXPIRED",
        updatedAt: recoveryAt,
      })
      .where(and(
        inArray(notificationOutbox.status, ["publishing", "processing"]),
        lte(notificationOutbox.leaseExpiresAt, recoveryAt),
      ));

    const dueRows = await database
      .select({ eventId: notificationOutbox.eventId })
      .from(notificationOutbox)
      .where(and(
        inArray(notificationOutbox.status, ["pending", "retry"]),
        lte(notificationOutbox.availableAt, recoveryAt),
        or(
          isNull(notificationOutbox.leaseExpiresAt),
          lte(notificationOutbox.leaseExpiresAt, recoveryAt),
        ),
      ))
      .orderBy(notificationOutbox.availableAt, notificationOutbox.createdAt)
      .limit(boundedLimit);

    let published = 0;
    for (const row of dueRows as Array<{ eventId: string }>) {
      if (await publishCommittedNotification(row.eventId)) published += 1;
    }
    return published;
  }

  async function completeOutbox(
    outboxId: string,
    leaseExpiresAt: Date,
    completedAt: Date,
  ) {
    await database
      .update(notificationOutbox)
      .set({
        status: "completed",
        leaseExpiresAt: null,
        lastErrorCode: null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(and(
        eq(notificationOutbox.id, outboxId),
        eq(notificationOutbox.status, "processing"),
        eq(notificationOutbox.leaseExpiresAt, leaseExpiresAt),
      ));
  }

  async function markDead(
    outboxId: string,
    leaseExpiresAt: Date,
    code: string,
    deadAt: Date,
  ) {
    await database
      .update(notificationOutbox)
      .set({
        status: "dead",
        leaseExpiresAt: null,
        lastErrorCode: boundedErrorCode(code, "NOTIFICATION_DEAD"),
        updatedAt: deadAt,
      })
      .where(and(
        eq(notificationOutbox.id, outboxId),
        eq(notificationOutbox.status, "processing"),
        eq(notificationOutbox.leaseExpiresAt, leaseExpiresAt),
      ));
  }

  async function processNotificationMessage(
    message: NotificationQueueMessageV1,
  ): Promise<{ completed: boolean; retryAt?: Date }> {
    if (message.deduplicationKey !== `notification:${message.eventId}`) {
      throw new Error("NOTIFICATION_QUEUE_MESSAGE_MISMATCH");
    }

    const claimAt = now();
    const [terminal] = await database
      .select({ status: notificationOutbox.status })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.eventId, message.eventId))
      .limit(1);
    if (!terminal || terminal.status === "completed" || terminal.status === "dead") {
      return { completed: true };
    }

    const [claim] = await database
      .update(notificationOutbox)
      .set({
        status: "processing",
        leaseExpiresAt: addMilliseconds(claimAt, processingLeaseMs),
        updatedAt: claimAt,
      })
      .where(and(
        eq(notificationOutbox.eventId, message.eventId),
        lte(notificationOutbox.availableAt, claimAt),
        or(
          inArray(notificationOutbox.status, ["published", "retry"]),
          and(
            eq(notificationOutbox.status, "processing"),
            lte(notificationOutbox.leaseExpiresAt, claimAt),
          ),
        ),
      ))
      .returning({
        id: notificationOutbox.id,
        attemptCount: notificationOutbox.attemptCount,
        firstAttemptAt: notificationOutbox.firstAttemptAt,
        leaseExpiresAt: notificationOutbox.leaseExpiresAt,
      });

    if (!claim) {
      const [current] = await database
        .select({
          status: notificationOutbox.status,
          availableAt: notificationOutbox.availableAt,
          leaseExpiresAt: notificationOutbox.leaseExpiresAt,
        })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.eventId, message.eventId))
        .limit(1);
      if (current?.status === "completed" || current?.status === "dead") {
        return { completed: true };
      }
      return {
        completed: false,
        ...(current?.availableAt ? { retryAt: current.availableAt } : {}),
      };
    }

    const [event, settings] = await Promise.all([
      database
        .select({
          category: notificationEvents.category,
          target: notificationEvents.target,
          entityId: notificationEvents.entityId,
          quietHoursPolicy: notificationEvents.quietHoursPolicy,
        })
        .from(notificationEvents)
        .where(eq(notificationEvents.id, message.eventId))
        .limit(1)
        .then((rows: unknown[]) => rows[0]),
      database
        .select({ prefs: storeSettings.prefs })
        .from(storeSettings)
        .where(eq(storeSettings.id, "default"))
        .limit(1)
        .then((rows: unknown[]) => rows[0]),
    ]) as [
      {
        category: string;
        target: string;
        entityId: string;
        quietHoursPolicy: string;
      } | undefined,
      { prefs: unknown } | undefined,
    ];

    if (!event || !isNotificationCategory(event.category)) {
      await markDead(
        claim.id,
        claim.leaseExpiresAt,
        "NOTIFICATION_EVENT_INVALID",
        now(),
      );
      return { completed: true };
    }
    const category = event.category;

    const prefs = parseStorePrefs(settings?.prefs);
    const notifications = prefs.notifications;

    if (
      !notifications[category]
      || !notifications.channels.push
    ) {
      await completeOutbox(claim.id, claim.leaseExpiresAt, now());
      return { completed: true };
    }

    if (
      event.quietHoursPolicy === "defer"
      && isWithinQuietHours({ now: claimAt, ...notifications.quietHours })
    ) {
      const retryAt = quietHoursEnd(claimAt, notifications.quietHours);
      await database
        .update(notificationOutbox)
        .set({
          status: "retry",
          availableAt: retryAt,
          leaseExpiresAt: null,
          lastErrorCode: "QUIET_HOURS",
          updatedAt: now(),
        })
        .where(and(
          eq(notificationOutbox.id, claim.id),
          eq(notificationOutbox.status, "processing"),
          eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
        ));
      return { completed: false, retryAt };
    }

    if (
      claim.attemptCount >= maxAttempts
      || (
        claim.firstAttemptAt
        && claimAt.getTime() - claim.firstAttemptAt.getTime() >= maxAttemptAgeMs
      )
    ) {
      await markDead(
        claim.id,
        claim.leaseExpiresAt,
        claim.attemptCount >= maxAttempts
          ? "NOTIFICATION_MAX_ATTEMPTS"
          : "NOTIFICATION_MAX_AGE",
        now(),
      );
      return { completed: true };
    }

    const [attempt] = await database
      .update(notificationOutbox)
      .set({
        attemptCount: sql`${notificationOutbox.attemptCount} + 1`,
        firstAttemptAt: sql`coalesce(${notificationOutbox.firstAttemptAt}, ${claimAt})`,
        updatedAt: claimAt,
      })
      .where(and(
        eq(notificationOutbox.id, claim.id),
        eq(notificationOutbox.status, "processing"),
        eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
      ))
      .returning({
        attemptCount: notificationOutbox.attemptCount,
        firstAttemptAt: notificationOutbox.firstAttemptAt,
      });

    if (!attempt) return { completed: false };

    const recipients = await database
      .select({
        userId: notificationRecipients.userId,
        reason: notificationRecipients.reason,
        role: profiles.role,
        isActive: profiles.isActive,
      })
      .from(notificationRecipients)
      .innerJoin(profiles, eq(profiles.id, notificationRecipients.userId))
      .where(eq(notificationRecipients.eventId, message.eventId));
    const allowedRoles = notifications.roleRouting[category] as Role[];
    const eligibleUserIds = (recipients as Array<{
      userId: string;
      reason: string;
      role: Role;
      isActive: boolean;
    }>)
      .filter((recipient) =>
        recipient.isActive
        && (recipient.reason === "direct" || allowedRoles.includes(recipient.role))
      )
      .map((recipient) => recipient.userId);

    if (eligibleUserIds.length === 0) {
      await completeOutbox(claim.id, claim.leaseExpiresAt, now());
      return { completed: true };
    }

    const effectiveProfiles = alias(profiles, "notification_effective_profiles");
    const devices = await database
      .select({
        id: mobilePushDevices.id,
        token: mobilePushDevices.token,
        locale: mobilePushDevices.locale,
      })
      .from(mobilePushDevices)
      .innerJoin(profiles, eq(profiles.id, mobilePushDevices.userId))
      .innerJoin(
        effectiveProfiles,
        eq(effectiveProfiles.id, mobilePushDevices.effectiveUserId),
      )
      .where(and(
        inArray(mobilePushDevices.effectiveUserId, [...new Set(eligibleUserIds)]),
        eq(mobilePushDevices.enabled, true),
        eq(mobilePushDevices.permission, "authorized"),
        eq(profiles.isActive, true),
        eq(effectiveProfiles.isActive, true),
      ));

    if (devices.length === 0) {
      await completeOutbox(claim.id, claim.leaseExpiresAt, now());
      return { completed: true };
    }

    const notificationKey = `event:${message.eventId}`;
    const typedDevices = devices as Array<{
      id: string;
      token: string;
      locale: string | null;
    }>;
    const deviceClaims: Array<{
      device: (typeof typedDevices)[number];
      claim:
        | { kind: "owned"; id: string; attemptedAt: Date }
        | { kind: "sent" }
        | { kind: "retry"; code: string; retryAfterMs: number };
    }> = [];

    for (const device of typedDevices) {
      const deviceClaimAt = now();
      const deviceClaim = await database.transaction(async (tx: DatabaseLike) => {
        const [owner] = await tx
          .select({ id: notificationOutbox.id })
          .from(notificationOutbox)
          .where(and(
            eq(notificationOutbox.id, claim.id),
            eq(notificationOutbox.status, "processing"),
            eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
          ))
          .limit(1)
          .for("update");
        if (!owner) {
          return {
            kind: "retry" as const,
            code: "NOTIFICATION_LEASE_LOST",
            retryAfterMs: processingLeaseMs,
          };
        }

        const [insertedClaim] = await tx
          .insert(mobilePushDeliveries)
          .values({
            deviceId: device.id,
            notificationKey,
            status: "sending",
            errorCode: null,
            attemptedAt: deviceClaimAt,
          })
          .onConflictDoNothing({
            target: [
              mobilePushDeliveries.deviceId,
              mobilePushDeliveries.notificationKey,
            ],
          })
          .returning({
            id: mobilePushDeliveries.id,
            attemptedAt: mobilePushDeliveries.attemptedAt,
          });
        if (insertedClaim) return { kind: "owned" as const, ...insertedClaim };

        const [previous] = await tx
          .select({
            id: mobilePushDeliveries.id,
            status: mobilePushDeliveries.status,
            attemptedAt: mobilePushDeliveries.attemptedAt,
          })
          .from(mobilePushDeliveries)
          .where(and(
            eq(mobilePushDeliveries.deviceId, device.id),
            eq(mobilePushDeliveries.notificationKey, notificationKey),
          ))
          .limit(1);
        if (previous?.status === "sent") {
          return { kind: "sent" as const };
        }

        const staleSending = previous?.status === "sending"
          && previous.attemptedAt.getTime() + deviceSendLeaseMs <= deviceClaimAt.getTime();
        if (previous && (previous.status === "failed" || staleSending)) {
          const [reclaimed] = await tx
            .update(mobilePushDeliveries)
            .set({
              status: "sending",
              errorCode: null,
              attempts: sql`${mobilePushDeliveries.attempts} + 1`,
              attemptedAt: deviceClaimAt,
            })
            .where(and(
              eq(mobilePushDeliveries.id, previous.id),
              eq(mobilePushDeliveries.status, previous.status),
              eq(mobilePushDeliveries.attemptedAt, previous.attemptedAt),
            ))
            .returning({
              id: mobilePushDeliveries.id,
              attemptedAt: mobilePushDeliveries.attemptedAt,
            });
          if (reclaimed) return { kind: "owned" as const, ...reclaimed };
        }

        const retryAt = previous?.attemptedAt
          ? addMilliseconds(previous.attemptedAt, deviceSendLeaseMs)
          : addMilliseconds(deviceClaimAt, deviceSendLeaseMs);
        return {
          kind: "retry" as const,
          code: "NOTIFICATION_DEVICE_BUSY",
          retryAfterMs: Math.max(0, retryAt.getTime() - deviceClaimAt.getTime()),
        };
      });
      deviceClaims.push({ device, claim: deviceClaim });
    }

    const results = await Promise.all(deviceClaims.map(async ({ device, claim: deviceClaim }) => {
      if (deviceClaim.kind === "sent") {
        return { kind: "sent" as const, skipped: true };
      }
      if (deviceClaim.kind === "retry") {
        return deviceClaim;
      }

      let result: DeviceNotificationResult;
      try {
        result = await sender({
          token: device.token,
          locale: device.locale,
          eventId: message.eventId,
          notificationKey,
          category,
          target: event.target as NotificationTarget,
          entityId: event.entityId,
        });
      } catch {
        result = { kind: "retry", code: "FCM_NETWORK" };
      }

      const attemptedAt = now();
      const status = result.kind === "sent" ? "sent" : "failed";
      const errorCode = result.kind === "sent"
        ? null
        : boundedErrorCode(result.code, "FCM_FAILED");
      const [persisted] = await database
        .update(mobilePushDeliveries)
        .set({ status, errorCode })
        .where(and(
          eq(mobilePushDeliveries.id, deviceClaim.id),
          eq(mobilePushDeliveries.status, "sending"),
          eq(mobilePushDeliveries.attemptedAt, deviceClaim.attemptedAt),
        ))
        .returning({ status: mobilePushDeliveries.status });

      if (!persisted) {
        const [current] = await database
          .select({ status: mobilePushDeliveries.status })
          .from(mobilePushDeliveries)
          .where(eq(mobilePushDeliveries.id, deviceClaim.id))
          .limit(1);
        if (current?.status === "sent") {
          return { kind: "sent" as const, skipped: true };
        }
        return {
          kind: "retry" as const,
          code: "NOTIFICATION_DEVICE_STALE",
          retryAfterMs: deviceSendLeaseMs,
        };
      }

      if (result.kind === "disable-token") {
        await database
          .update(mobilePushDevices)
          .set({ enabled: false, updatedAt: attemptedAt })
          .where(and(
            eq(mobilePushDevices.id, device.id),
            eq(mobilePushDevices.token, device.token),
          ));
      }
      return result;
    }));

    const permanent = results.find((result) => result.kind === "permanent");
    if (permanent?.kind === "permanent") {
      await markDead(claim.id, claim.leaseExpiresAt, permanent.code, now());
      return { completed: true };
    }

    const retryable = results.filter(
      (result): result is Extract<DeviceNotificationResult, { kind: "retry" }> =>
        result.kind === "retry",
    );
    if (retryable.length > 0) {
      const failedAt = now();
      const retryAfterMs = Math.max(
        0,
        ...retryable.map((result) => result.retryAfterMs ?? 0),
      );
      if (
        attempt.attemptCount >= maxAttempts
        || (
          attempt.firstAttemptAt
          && failedAt.getTime() - attempt.firstAttemptAt.getTime() >= maxAttemptAgeMs
        )
      ) {
        await markDead(
          claim.id,
          claim.leaseExpiresAt,
          retryable[0].code,
          failedAt,
        );
        return { completed: true };
      }

      const retryAt = retryDate(failedAt, attempt.attemptCount, jitter, retryAfterMs);
      await database
        .update(notificationOutbox)
        .set({
          status: "retry",
          availableAt: retryAt,
          leaseExpiresAt: null,
          lastErrorCode: boundedErrorCode(retryable[0].code, "FCM_RETRY"),
          updatedAt: failedAt,
        })
        .where(and(
          eq(notificationOutbox.id, claim.id),
          eq(notificationOutbox.status, "processing"),
          eq(notificationOutbox.leaseExpiresAt, claim.leaseExpiresAt),
        ));
      return { completed: false, retryAt };
    }

    await completeOutbox(claim.id, claim.leaseExpiresAt, now());
    return { completed: true };
  }

  async function republishDeadNotificationForUser(
    userId: string,
    eventId: string,
  ): Promise<ActionResult<void>> {
    const resetAt = now();
    const reset = await database.transaction(async (tx: DatabaseLike) => {
      const [actor] = await tx
        .select({ role: profiles.role, isActive: profiles.isActive })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1)
        .for("update");
      if (
        !actor?.isActive
        || (actor.role !== "owner" && actor.role !== "manager")
      ) {
        return { authorized: false, row: undefined };
      }

      const [row] = await tx
        .update(notificationOutbox)
        .set({
          status: "pending",
          provider: null,
          providerMessageId: null,
          attemptCount: 0,
          availableAt: resetAt,
          leaseExpiresAt: null,
          lastErrorCode: null,
          publishedAt: null,
          firstAttemptAt: null,
          completedAt: null,
          updatedAt: resetAt,
        })
        .where(and(
          eq(notificationOutbox.eventId, eventId),
          eq(notificationOutbox.status, "dead"),
        ))
        .returning({ id: notificationOutbox.id });
      return { authorized: true, row };
    });
    if (!reset.authorized) return { ok: false, error: "errors.forbidden" };
    if (!reset.row) return { ok: false, error: "errors.conflict" };

    await publishCommittedNotification(eventId);
    return { ok: true, data: undefined };
  }

  return {
    publishCommittedNotification,
    recoverDueNotifications,
    processNotificationMessage,
    republishDeadNotificationForUser,
  };
}
