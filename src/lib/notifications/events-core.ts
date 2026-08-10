import { and, eq, inArray } from "drizzle-orm";
import {
  notificationEvents,
  notificationOutbox,
  notificationRecipients,
  profiles,
  storeSettings,
} from "@/db/schema";
import type {
  NotificationCategory,
  NotificationPriority,
  NotificationTarget,
  QuietHoursPolicy,
} from "@/lib/notifications/contracts";
import { allowedRolesForNotificationTarget } from "@/lib/notifications/routing-policy";
import { parseStorePrefs } from "@/lib/schemas/settings";

// Drizzle's Postgres and PGlite transactions expose the same fluent API with
// different generic brands. This core accepts either runtime for production and tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbLike = any;

export type CreateNotificationEventInput = {
  storeId: string;
  eventKey: string;
  category: NotificationCategory;
  entityType: "order" | "purchase" | "customer" | "supplier" | "payment";
  entityId: string;
  actorId?: string | null;
  target: NotificationTarget;
  priority: NotificationPriority;
  quietHoursPolicy: QuietHoursPolicy;
  directUserIds?: string[];
  excludeActor?: boolean;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

type CreatedNotificationEvent = { eventId: string; created: boolean };

export function debtEventKey(input: {
  entityType: "customer" | "supplier";
  entityId: string;
  operationType: string;
  operationId: string;
}) {
  return [
    "debt-changed",
    input.entityType,
    input.entityId,
    input.operationType,
    input.operationId,
  ].join(":");
}

export async function createNotificationEventInTx(
  tx: DbLike,
  input: CreateNotificationEventInput,
): Promise<CreatedNotificationEvent | null> {
  const [settings] = await tx
    .select({ prefs: storeSettings.prefs })
    .from(storeSettings)
    .where(eq(storeSettings.storeId, input.storeId))
    .limit(1);
  const prefs = parseStorePrefs(settings?.prefs);

  if (!prefs.notifications[input.category]) return null;

  const [inserted] = await tx
    .insert(notificationEvents)
    .values({
      storeId: input.storeId,
      eventKey: input.eventKey,
      category: input.category,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      target: input.target,
      priority: input.priority,
      quietHoursPolicy: input.quietHoursPolicy,
      metadata: input.metadata ?? {},
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing({ target: [notificationEvents.storeId, notificationEvents.eventKey] })
    .returning({ id: notificationEvents.id });

  if (!inserted) {
    const [existing] = await tx
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(and(eq(notificationEvents.storeId, input.storeId), eq(notificationEvents.eventKey, input.eventKey)))
      .limit(1);
    if (!existing) throw new Error("NOTIFICATION_EVENT_CONFLICT_UNRESOLVED");
    return { eventId: existing.id, created: false };
  }

  const directUserIds = [...new Set(input.directUserIds ?? [])];
  const targetRoles = allowedRolesForNotificationTarget({
    category: input.category,
    target: input.target,
    entityType: input.entityType,
  });
  const routedRoles = prefs.notifications.roleRouting[input.category]
    .filter((role) => targetRoles.includes(role));
  const roleRecipients = routedRoles.length === 0
    ? []
    : await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(
        eq(profiles.isActive, true),
        eq(profiles.storeId, input.storeId),
        inArray(profiles.role, routedRoles),
      ));
  const directRecipients = directUserIds.length === 0
    ? []
    : await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.storeId, input.storeId), eq(profiles.isActive, true), inArray(profiles.id, directUserIds)));

  const directRecipientIds = new Set(
    (directRecipients as Array<{ id: string }>).map((profile) => profile.id),
  );
  const recipientReasons = new Map<string, "role" | "direct">();
  for (const recipient of roleRecipients as Array<{ id: string }>) {
    recipientReasons.set(recipient.id, "role");
  }
  for (const recipient of directRecipients as Array<{ id: string }>) {
    recipientReasons.set(recipient.id, "direct");
  }
  if (input.excludeActor && input.actorId && !directRecipientIds.has(input.actorId)) {
    recipientReasons.delete(input.actorId);
  }

  const recipientRows = [...recipientReasons].map(([userId, reason]) => ({
    storeId: input.storeId,
    eventId: inserted.id,
    userId,
    reason,
  }));
  if (recipientRows.length > 0) await tx.insert(notificationRecipients).values(recipientRows);
  await tx.insert(notificationOutbox).values({ storeId: input.storeId, eventId: inserted.id });

  return { eventId: inserted.id, created: true };
}

function roundMoney(value: number) {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

export async function createDebtChangedEventInTx(
  tx: DbLike,
  input: {
    storeId: string;
    entityType: "customer" | "supplier";
    entityId: string;
    operationType: string;
    operationId: string;
    delta: number;
    actorId?: string | null;
    relatedAdjustments?: Array<{
      entityType: "customer" | "supplier";
      entityId: string;
      delta: number;
    }>;
  },
): Promise<CreatedNotificationEvent | null> {
  const delta = roundMoney(input.delta);
  const relatedAdjustments = (input.relatedAdjustments ?? []).map((adjustment) => ({
    ...adjustment,
    delta: roundMoney(adjustment.delta),
  }));
  const netDelta = roundMoney(delta + relatedAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.delta,
    0,
  ));
  if (netDelta === 0) return null;

  const metadata: Record<string, unknown> = {
    delta,
    operationType: input.operationType,
  };
  if (relatedAdjustments.length > 0) metadata.relatedAdjustments = relatedAdjustments;

  return createNotificationEventInTx(tx, {
    storeId: input.storeId,
    eventKey: debtEventKey(input),
    category: "debtChanged",
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    target: "debt",
    priority: "normal",
    quietHoursPolicy: "defer",
    excludeActor: true,
    metadata,
  });
}
