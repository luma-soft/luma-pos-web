import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getProfileId } from "@/lib/actions/common";
import { getCurrentShift } from "@/lib/data/shifts";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import {
  createSupplierPayableEntry as createEntryCore,
  paySupplierPayable as payCore,
  type PaySupplierInput,
  type SupplierPayableEntryInput,
} from "@/lib/payables/service-core";
import { Routes } from "@/lib/routes";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";

async function actorForUser(userId: string, source: "manual" | "mobile") {
  const context = await resolveStoreContextForUser(userId);
  if (!context) throw new Error("UNAUTHORIZED");
  const profileId = await getProfileId(userId);
  const shift = profileId ? await getCurrentShift(context.storeId, profileId) : null;
  return { storeId: context.storeId, profileId, shiftId: shift?.id ?? null, source };
}

export async function paySupplierPayableForUser(
  userId: string,
  input: PaySupplierInput,
  source: "manual" | "mobile" = "manual",
) {
  const result = await payCore(db, input, await actorForUser(userId, source));
  if (result.ok) {
    if (result.data.notificationEventId) await publishCommittedNotification(result.data.notificationEventId);
    revalidatePath(Routes.Suppliers);
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Purchases);
    for (const allocation of input.allocations) {
      revalidatePath(Routes.purchase(allocation.purchaseOrderId));
    }
  }
  return result;
}

export async function createSupplierPayableEntryForUser(
  userId: string,
  input: SupplierPayableEntryInput,
  source: "manual" | "mobile" = "manual",
) {
  const result = await createEntryCore(db, input, await actorForUser(userId, source));
  if (result.ok) {
    if (result.data.notificationEventId) await publishCommittedNotification(result.data.notificationEventId);
    revalidatePath(Routes.Suppliers);
    revalidatePath(Routes.Partners);
    if (input.purchaseOrderId) revalidatePath(Routes.purchase(input.purchaseOrderId));
  }
  return result;
}
