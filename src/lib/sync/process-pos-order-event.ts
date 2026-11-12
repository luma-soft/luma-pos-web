import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { createOrderForSalesPrincipal } from "@/lib/orders/create-command";
import { CHECKOUT_PRICING_CHANGED } from "@/lib/orders/checkout-pricing";
import { syncRelaySubmitSchema } from "@/lib/sync/relay";

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
  const parsed = syncRelaySubmitSchema.safeParse(command);
  if (!parsed.success) {
    return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
  }

  const principal = await resolveStoreContextForUser(userId);
  if (!principal || principal.storeId !== parsed.data.storeId) {
    return { status: "rejected", result: null, errorCode: "errors.forbidden" };
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
