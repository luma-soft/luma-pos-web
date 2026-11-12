import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { createOrderForSalesPrincipal } from "@/lib/orders/create-command";
import { CHECKOUT_PRICING_CHANGED } from "@/lib/orders/checkout-pricing";
import { posOrderSyncSchema } from "@/lib/sync/relay";

export type PosOrderRelayResult =
  | { status: "accepted"; result: { id: string; code: string }; errorCode: null }
  | { status: "rejected" | "conflict"; result: null; errorCode: string };

export async function processPosOrderRelayEvent(
  input: {
    eventId: string;
    storeId: string;
    userId: string;
    deviceId: string;
    baseRevision?: string | number | null;
    payload: unknown;
  },
): Promise<PosOrderRelayResult> {
  const { userId, ...rawCommand } = input;
  const command = {
    ...rawCommand,
    ...(rawCommand.baseRevision == null ? {} : { baseRevision: rawCommand.baseRevision }),
  };
  const parsed = posOrderSyncSchema.safeParse(command);
  if (!parsed.success) {
    return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
  }

  const principal = await resolveStoreContextForUser(userId);
  if (!principal || principal.storeId !== parsed.data.storeId) {
    return { status: "rejected", result: null, errorCode: "errors.forbidden" };
  }

  // Recover a committed order when the worker stopped before acknowledging its
  // sync receipt. Do this before pricing validation so a later catalog change
  // cannot turn an already-created order into a reported conflict.
  const clientId = parsed.data.payload.clientId;
  if (clientId) {
    const [existing] = await db.select({ id: orders.id, code: orders.code })
      .from(orders)
      .where(and(
        eq(orders.storeId, principal.storeId),
        eq(orders.clientId, clientId),
      ))
      .limit(1);
    if (existing) return { status: "accepted", result: existing, errorCode: null };
  }

  const result = await createOrderForSalesPrincipal(principal, parsed.data.payload);
  if (result.ok) {
    return { status: "accepted", result: result.data, errorCode: null };
  }

  const isConflict = result.error === CHECKOUT_PRICING_CHANGED
    || result.error === "errors.conflict"
    || result.error === "errors.versionConflict";
  return {
    status: isConflict ? "conflict" : "rejected",
    result: null,
    errorCode: result.error,
  };
}
