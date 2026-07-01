import { db } from "@/db";
import { zaloMessageEvents } from "@/db/schema";

type ZaloWebhookEvent = Record<string, unknown>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNestedString(source: unknown, path: string[]): string | null {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return readString(current);
}

function getEventName(event: ZaloWebhookEvent) {
  return readString(event.event_name) ?? readString(event.eventName) ?? "unknown";
}

function getSenderId(event: ZaloWebhookEvent) {
  return readNestedString(event, ["sender", "id"])
    ?? readNestedString(event, ["user", "id"])
    ?? readNestedString(event, ["follower", "id"])
    ?? readString(event.user_id)
    ?? readString(event.uid);
}

function getRecipientId(event: ZaloWebhookEvent) {
  return readNestedString(event, ["recipient", "id"]) ?? readString(event.oa_id) ?? readString(event.oaid);
}

function getMessageId(event: ZaloWebhookEvent) {
  return readNestedString(event, ["message", "msg_id"])
    ?? readNestedString(event, ["message", "message_id"])
    ?? readString(event.message_id)
    ?? readString(event.msg_id);
}

function getMessageText(event: ZaloWebhookEvent) {
  return readNestedString(event, ["message", "text"]) ?? readString(event.text);
}

function summarizeWebhookEvent(event: ZaloWebhookEvent) {
  return {
    eventName: getEventName(event),
    appId: readString(event.app_id),
    oaId: getRecipientId(event),
    userId: getSenderId(event),
    messageId: getMessageId(event),
    text: getMessageText(event),
    timestamp: readString(event.timestamp),
    raw: event,
  };
}

export async function logZaloWebhookEvent(event: ZaloWebhookEvent) {
  const summary = summarizeWebhookEvent(event);
  await db.insert(zaloMessageEvents).values({
    kind: summary.eventName,
    status: "received",
    zaloMessageId: summary.messageId,
    payloadSummary: summary,
  });
  return summary;
}
