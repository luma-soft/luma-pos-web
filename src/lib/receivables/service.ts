import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { db } from "@/db";
import { getProfileId } from "@/lib/actions/common";
import { getCurrentShift } from "@/lib/data/shifts";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import {
  collectCustomerReceivable as collectCore,
  createCustomerReceivableEntry as createEntryCore,
  type CollectReceivableInput,
  type ReceivableEntryInput,
} from "@/lib/receivables/service-core";
import { Routes } from "@/lib/routes";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";

async function actorForUser(userId: string) {
  const context = await resolveStoreContextForUser(userId);
  if (!context) throw new Error("UNAUTHORIZED");
  const profileId = await getProfileId(userId);
  const shift = profileId ? await getCurrentShift(context.storeId, profileId) : null;
  return { storeId: context.storeId, profileId, shiftId: shift?.id ?? null };
}

export async function collectCustomerReceivableForUser(userId: string, input: CollectReceivableInput) {
  const result = await collectCore(db, input, await actorForUser(userId));
  if (result.ok) {
    if (result.data.notificationEventId) await publishCommittedNotification(result.data.notificationEventId);
    revalidatePath(Routes.Customers);
    revalidatePath(Routes.Orders);
    for (const allocation of input.allocations) revalidatePath(Routes.order(allocation.orderId));
  }
  return result;
}

export async function createCustomerReceivableEntryForUser(userId: string, input: ReceivableEntryInput) {
  const result = await createEntryCore(db, input, await actorForUser(userId));
  if (result.ok) {
    if (result.data.notificationEventId) await publishCommittedNotification(result.data.notificationEventId);
    revalidatePath(Routes.Customers);
    if (input.orderId) revalidatePath(Routes.order(input.orderId));
  }
  return result;
}
