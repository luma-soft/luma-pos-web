import { and, eq, sql } from "drizzle-orm";
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

const persistedMobileEventValidity = sql`
  events.contract_version = 1
  AND events.priority IN ('normal', 'high')
  AND (
    (events.category = 'invoiceCreated' AND events.target = 'invoices')
    OR (
      events.category = 'purchaseReceived'
      AND events.target = 'purchases'
    )
    OR (events.category = 'debtChanged' AND events.target = 'debt')
    OR (
      events.category = 'qrPaymentConfirmed'
      AND events.target = 'invoices'
    )
    OR (
      events.category = 'qrPaymentException'
      AND events.target = 'paymentReconciliation'
    )
  )
`;

export function persistedMobileEventListQuery(effectiveProfileId: string) {
  return sql`
    SELECT
      events.id,
      events.category,
      events.target,
      events.entity_id AS "entityId",
      events.priority,
      events.created_at AS "createdAt",
      (
        SELECT recipients.read_at
        FROM notification_recipients AS recipients
        WHERE recipients.event_id = events.id
          AND recipients.user_id = ${effectiveProfileId}
          AND recipients.dismissed_at IS NULL
        LIMIT 1
      ) AS "readAt"
    FROM notification_events AS events
    WHERE ${persistedMobileEventValidity}
      AND EXISTS (
        SELECT 1
        FROM notification_recipients AS recipients
        WHERE recipients.event_id = events.id
          AND recipients.user_id = ${effectiveProfileId}
          AND recipients.dismissed_at IS NULL
      )
    ORDER BY events.created_at DESC, events.id DESC
    LIMIT ${persistedMobileEventLimit}
  `;
}

function persistedMobileEventCountQuery(effectiveProfileId: string) {
  return sql`
    SELECT
      count(*)::int AS "all",
      count(*) FILTER (
        WHERE (
          SELECT recipients.read_at
          FROM notification_recipients AS recipients
          WHERE recipients.event_id = events.id
            AND recipients.user_id = ${effectiveProfileId}
            AND recipients.dismissed_at IS NULL
          LIMIT 1
        ) IS NULL
      )::int AS "unread",
      count(*) FILTER (
        WHERE events.category = 'invoiceCreated'
      )::int AS "invoiceCreated",
      count(*) FILTER (
        WHERE events.category = 'purchaseReceived'
      )::int AS "purchaseReceived",
      count(*) FILTER (
        WHERE events.category = 'debtChanged'
      )::int AS "debtChanged",
      count(*) FILTER (
        WHERE events.category = 'qrPaymentConfirmed'
      )::int AS "qrPaymentConfirmed",
      count(*) FILTER (
        WHERE events.category = 'qrPaymentException'
      )::int AS "qrPaymentException"
    FROM notification_events AS events
    WHERE ${persistedMobileEventValidity}
      AND EXISTS (
        SELECT 1
        FROM notification_recipients AS recipients
        WHERE recipients.event_id = events.id
          AND recipients.user_id = ${effectiveProfileId}
          AND recipients.dismissed_at IS NULL
      )
  `;
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (
    result
    && typeof result === "object"
    && "rows" in result
    && Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

export async function listPersistedMobileEvents(
  effectiveProfileId: string,
  locale: string,
): Promise<MobileNotificationEventRow[]> {
  const rows = resultRows(
    await db.execute(persistedMobileEventListQuery(effectiveProfileId)),
  ) as Array<{
    id: string;
    category: string;
    target: string;
    entityId: string;
    priority: string;
    createdAt: Date | string;
    readAt: Date | string | null;
  }>;

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
      createdAt: new Date(row.createdAt).toISOString(),
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
  const [row] = resultRows(
    await db.execute(persistedMobileEventCountQuery(effectiveProfileId)),
  );

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
