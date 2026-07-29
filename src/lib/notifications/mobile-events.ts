import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationEvents, notificationRecipients } from "@/db/schema";
import {
  notificationCategories,
  notificationTargets,
  type NotificationCategory,
  type NotificationTarget,
} from "@/lib/notifications/contracts";
import { localizedNotificationCopy } from "@/lib/notifications/notification-copy";

export type MobileNotificationEventRow = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  unread: boolean;
  priority: "normal" | "high";
  createdAt: string;
  action: {
    type: "open";
    target: NotificationTarget;
    id: string;
  };
};

export type MobileNotificationResolution = {
  eventId: string;
  category: NotificationCategory;
  target: NotificationTarget;
  entityType: string;
  entityId: string;
};

export const persistedMobileEventLimit = 50;

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function isNotificationCategory(value: string): value is NotificationCategory {
  return notificationCategories.some((category) => category === value);
}

function isNotificationTarget(value: string): value is NotificationTarget {
  return notificationTargets.some((target) => target === value);
}

export function localizedMobileEventCopy(
  category: NotificationCategory,
  locale: string,
) {
  return localizedNotificationCopy(category, locale);
}

export async function listPersistedMobileEvents(
  effectiveProfileId: string,
  locale: string,
): Promise<MobileNotificationEventRow[]> {
  const rows = await db
    .select({
      id: notificationEvents.id,
      category: notificationEvents.category,
      target: notificationEvents.target,
      entityId: notificationEvents.entityId,
      priority: notificationEvents.priority,
      createdAt: notificationEvents.createdAt,
      readAt: notificationRecipients.readAt,
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(and(
      eq(notificationRecipients.userId, effectiveProfileId),
      isNull(notificationRecipients.dismissedAt),
    ))
    .orderBy(desc(notificationEvents.createdAt))
    .limit(persistedMobileEventLimit);

  return rows.flatMap((row) => {
    if (
      !isNotificationCategory(row.category)
      || !isNotificationTarget(row.target)
      || (row.priority !== "normal" && row.priority !== "high")
    ) {
      return [];
    }
    const copy = localizedMobileEventCopy(row.category, locale);
    return [{
      id: row.id,
      category: row.category,
      ...copy,
      unread: row.readAt === null,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      action: {
        type: "open" as const,
        target: row.target,
        id: row.entityId,
      },
    }];
  });
}

export type PersistedMobileEventCounts = {
  all: number;
  unread: number;
  invoiceCreated: number;
  purchaseReceived: number;
  debtChanged: number;
  qrPaymentConfirmed: number;
  qrPaymentException: number;
};

export async function countPersistedMobileEvents(
  effectiveProfileId: string,
): Promise<PersistedMobileEventCounts> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      unread: sql<number>`
        count(*) filter (where ${notificationRecipients.readAt} is null)::int
      `,
      invoiceCreated: sql<number>`
        count(*) filter (where ${notificationEvents.category} = 'invoiceCreated')::int
      `,
      purchaseReceived: sql<number>`
        count(*) filter (where ${notificationEvents.category} = 'purchaseReceived')::int
      `,
      debtChanged: sql<number>`
        count(*) filter (where ${notificationEvents.category} = 'debtChanged')::int
      `,
      qrPaymentConfirmed: sql<number>`
        count(*) filter (where ${notificationEvents.category} = 'qrPaymentConfirmed')::int
      `,
      qrPaymentException: sql<number>`
        count(*) filter (where ${notificationEvents.category} = 'qrPaymentException')::int
      `,
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(and(
      eq(notificationRecipients.userId, effectiveProfileId),
      isNull(notificationRecipients.dismissedAt),
    ));

  return {
    all: Number(row?.all ?? 0),
    unread: Number(row?.unread ?? 0),
    invoiceCreated: Number(row?.invoiceCreated ?? 0),
    purchaseReceived: Number(row?.purchaseReceived ?? 0),
    debtChanged: Number(row?.debtChanged ?? 0),
    qrPaymentConfirmed: Number(row?.qrPaymentConfirmed ?? 0),
    qrPaymentException: Number(row?.qrPaymentException ?? 0),
  };
}

export async function resolvePersistedMobileEvent(
  eventId: string,
  effectiveProfileId: string,
): Promise<MobileNotificationResolution | null> {
  if (!uuidPattern.test(eventId)) return null;

  const [row] = await db
    .select({
      eventId: notificationEvents.id,
      category: notificationEvents.category,
      target: notificationEvents.target,
      entityType: notificationEvents.entityType,
      entityId: notificationEvents.entityId,
    })
    .from(notificationRecipients)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationRecipients.eventId),
    )
    .where(and(
      eq(notificationRecipients.userId, effectiveProfileId),
      eq(notificationEvents.id, eventId),
    ))
    .limit(1);

  if (
    !row
    || !isNotificationCategory(row.category)
    || !isNotificationTarget(row.target)
  ) {
    return null;
  }
  return {
    eventId: row.eventId,
    category: row.category,
    target: row.target,
    entityType: row.entityType,
    entityId: row.entityId,
  };
}

export async function updatePersistedMobileRecipient(input: {
  eventId: string;
  effectiveProfileId: string;
  read: boolean;
  dismissed: boolean;
}) {
  if (!uuidPattern.test(input.eventId)) return false;

  const now = new Date();
  const updated = await db
    .update(notificationRecipients)
    .set({
      readAt: input.read ? now : null,
      dismissedAt: input.dismissed ? now : null,
    })
    .where(and(
      eq(notificationRecipients.eventId, input.eventId),
      eq(notificationRecipients.userId, input.effectiveProfileId),
    ))
    .returning({ id: notificationRecipients.id });
  return updated.length > 0;
}
