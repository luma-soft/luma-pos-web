import { sql } from "drizzle-orm";
import { getProfileId } from "@/lib/actions/common";
import { db } from "@/db";
import { mobileNotificationStates } from "@/db/schema";
import { requireMobileUser } from "@/lib/mobile/auth";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";
import {
  resolvePersistedMobileEvent,
  updatePersistedMobileRecipient,
} from "@/lib/notifications/mobile-events";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const profileId = await getProfileId(gate.userId);
  const resolution = await resolvePersistedMobileEvent(
    id,
    profileId ?? gate.userId,
  );
  return resolution
    ? mobileOk(resolution)
    : mobileError("errors.notFound", 404);
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  const { id } = await params;
  const body = await readJson(request);
  const profileId = await getProfileId(gate.userId);
  const stateUserId = profileId ?? gate.userId;
  const payload = body && typeof body === "object"
    ? body as { read?: unknown; dismissed?: unknown }
    : {};
  const read = payload.read !== false;
  const dismissed = payload.dismissed === true;

  const updatedPersistedRecipient = await updatePersistedMobileRecipient({
    eventId: id,
    effectiveProfileId: stateUserId,
    read,
    dismissed,
  });

  if (updatedPersistedRecipient) {
    return mobileOk({
      id,
      applied: { read, dismissed },
    });
  }

  await db
    .insert(mobileNotificationStates)
    .values({
      userId: stateUserId,
      notificationId: id,
      read,
      dismissed,
    })
    .onConflictDoUpdate({
      target: [
        mobileNotificationStates.userId,
        mobileNotificationStates.notificationId,
      ],
      set: {
        read,
        dismissed,
        updatedAt: sql`now()`,
      },
    });

  return mobileOk({
    id,
    applied: { read, dismissed },
  });
}
