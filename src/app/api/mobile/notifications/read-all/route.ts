import { and, eq, isNull, sql } from "drizzle-orm";
import { getProfileId } from "@/lib/actions/common";
import { db } from "@/db";
import { mobileNotificationStates, notificationRecipients } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

const notificationIdPattern = /^[A-Za-z0-9_-]{1,160}$/;
const persistedEventIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function legacyNotificationIds(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const ids = (payload as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return [];

  return [...new Set(ids.filter(
    (id): id is string =>
      typeof id === "string"
      && notificationIdPattern.test(id)
      && !persistedEventIdPattern.test(id),
  ))];
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  const body = await readJson(request);
  const profileId = await getProfileId(gate.userId);
  const stateUserId = profileId ?? gate.userId;
  const readAt = new Date();
  const legacyIds = legacyNotificationIds(body);

  await db.transaction(async (tx) => {
    await tx
      .update(notificationRecipients)
      .set({ readAt })
      .where(and(
        eq(notificationRecipients.storeId, gate.storeId),
        eq(notificationRecipients.userId, stateUserId),
        isNull(notificationRecipients.readAt),
        isNull(notificationRecipients.dismissedAt),
      ));

    if (legacyIds.length > 0) {
      await tx
        .insert(mobileNotificationStates)
        .values(legacyIds.map((notificationId) => ({
          storeId: gate.storeId,
          userId: stateUserId,
          notificationId,
          read: true,
          dismissed: false,
        })))
        .onConflictDoUpdate({
          target: [
            mobileNotificationStates.userId,
            mobileNotificationStates.notificationId,
          ],
          set: {
            read: true,
            updatedAt: sql`now()`,
          },
        });
    }
  });

  return mobileOk({ applied: true });
}
