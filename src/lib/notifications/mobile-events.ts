import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notificationEvents, notificationRecipients } from "@/db/schema";
import {
  notificationCategories,
  notificationTargets,
  type NotificationCategory,
  type NotificationTarget,
} from "@/lib/notifications/contracts";

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

const localizedTitles: Record<
  NotificationCategory,
  { vi: string; en: string }
> = {
  invoiceCreated: {
    vi: "Hóa đơn mới đã được tạo",
    en: "A new invoice was created",
  },
  purchaseReceived: {
    vi: "Đã ghi nhận phiếu nhập hàng",
    en: "A purchase receipt was recorded",
  },
  debtChanged: {
    vi: "Công nợ vừa được cập nhật",
    en: "A debt balance was updated",
  },
  qrPaymentConfirmed: {
    vi: "Đã xác nhận thanh toán QR",
    en: "QR payment confirmed",
  },
  qrPaymentException: {
    vi: "Cần kiểm tra giao dịch QR",
    en: "QR payment needs review",
  },
};

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
  const language = locale.toLowerCase().startsWith("en") ? "en" : "vi";
  return {
    title: localizedTitles[category][language],
    body: language === "en"
      ? "Open LumaPOS to view details."
      : "Mở LumaPOS để xem chi tiết.",
  };
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
    .orderBy(desc(notificationEvents.createdAt));

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
