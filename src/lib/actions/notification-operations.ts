"use server";

import type { ActionResult } from "@/lib/actions/common";
import { requireManager } from "@/lib/actions/common";
import { republishDeadNotification } from "@/lib/notifications/outbox";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function republishDeadNotificationForUser(
  userId: string,
  eventId: string,
): Promise<ActionResult<void>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  if (gate.userId !== userId) return { ok: false, error: "errors.forbidden" };
  if (!uuidPattern.test(eventId)) return { ok: false, error: "errors.invalidData" };

  try {
    return await republishDeadNotification(gate.userId, eventId);
  } catch {
    return { ok: false, error: "errors.serverError" };
  }
}
