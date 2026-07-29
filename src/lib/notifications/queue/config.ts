import type {
  NotificationQueuePublisher,
  NotificationQueueRequestVerifier,
} from "../contracts";
import {
  createQstashNotificationQueue,
  type QstashNotificationQueueConfig,
} from "./qstash";

function unconfigured(): never {
  throw new Error("NOTIFICATION_QUEUE_NOT_CONFIGURED");
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) return unconfigured();
  return value;
}

function resolveQstashConfig(env: Record<string, string | undefined>): QstashNotificationQueueConfig {
  return {
    token: required(env, "QSTASH_TOKEN"),
    workerUrl: required(env, "NOTIFICATION_QUEUE_WORKER_URL"),
    currentSigningKey: required(env, "QSTASH_CURRENT_SIGNING_KEY"),
    nextSigningKey: required(env, "QSTASH_NEXT_SIGNING_KEY"),
  };
}

export function resolveNotificationQueue(
  env: Record<string, string | undefined> = process.env,
): {
  provider: string;
  publisher: NotificationQueuePublisher;
  verifier: NotificationQueueRequestVerifier;
} {
  if (env.NOTIFICATION_QUEUE_PROVIDER !== "qstash") return unconfigured();

  const queue = createQstashNotificationQueue(resolveQstashConfig(env));
  return {
    provider: "qstash",
    ...queue,
  };
}
