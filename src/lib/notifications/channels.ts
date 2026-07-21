import { resolveFirebaseServiceAccount } from "@/lib/notifications/firebase-config";
import {
  notificationChannelRegistry,
  type NotificationChannelId,
} from "@/lib/notifications/channel-registry";

type NotificationEnvironment = Record<string, string | undefined>;

const configurationResolvers: Record<
  NotificationChannelId,
  (env: NotificationEnvironment) => boolean
> = {
  inApp: () => true,
  push: (env) => resolveFirebaseServiceAccount(env) !== null,
};

export function resolveNotificationChannels(
  env: NotificationEnvironment = process.env,
) {
  return notificationChannelRegistry.map((channel) => ({
    id: channel.id,
    configured: configurationResolvers[channel.id](env),
  }));
}
