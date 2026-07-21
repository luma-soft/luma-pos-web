export const notificationChannelRegistry = [
  { id: "inApp", defaultEnabled: true },
  { id: "push", defaultEnabled: true },
] as const;

export type NotificationChannelId =
  (typeof notificationChannelRegistry)[number]["id"];

export function defaultNotificationChannelPreferences(): Record<string, boolean> {
  return Object.fromEntries(
    notificationChannelRegistry.map((channel) => [
      channel.id,
      channel.defaultEnabled,
    ]),
  );
}
