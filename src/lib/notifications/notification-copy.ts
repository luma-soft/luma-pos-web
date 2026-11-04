import enMessages from "../../../messages/en.json";
import viMessages from "../../../messages/vi.json";
import type { NotificationCategory } from "@/lib/notifications/contracts";

type SupportedNotificationLocale = "vi" | "en";

const copyByLocale = {
  vi: viMessages.internalNotifications,
  en: enMessages.internalNotifications,
};

export type LegacyPushCategory =
  | "lowStock"
  | "einvoiceError"
  | "shiftClose"
  | "syncDone"
  | "serviceDue";

const legacyCopyByLocale = {
  vi: viMessages.notifications.operationalPush,
  en: enMessages.notifications.operationalPush,
};

export function notificationLocale(locale?: string | null): SupportedNotificationLocale {
  return locale?.toLowerCase().startsWith("en") ? "en" : "vi";
}

export function localizedNotificationCopy(
  category: NotificationCategory,
  locale?: string | null,
) {
  const messages = copyByLocale[notificationLocale(locale)];
  return {
    title: messages.titles[category],
    body: messages.categoryBodies?.[category] ?? messages.body,
  };
}

export function localizedLegacyPushCopy(
  category: LegacyPushCategory,
  locale?: string | null,
) {
  const messages = legacyCopyByLocale[notificationLocale(locale)];
  return {
    title: messages.titles[category],
    body: messages.bodies[category],
  };
}
