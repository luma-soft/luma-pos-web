import { getOrders } from "@/lib/data/orders";
import { createOrderForUser } from "@/lib/orders/create";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { getRawStorePrefs } from "@/lib/data/settings";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  OFFLINE_ACTOR_HEADER,
  validateOfflineReplayActor,
} from "@/lib/mobile/offline-actor";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";
import type { CreateOrderInput } from "@/lib/schemas/order";
import { createOrderSchema } from "@/lib/schemas/order";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import { evaluateOrderApprovalRequirement } from "@/lib/orders/sensitive-approval";
import { parseOrderListSearchParams } from "@/lib/orders/list-filter-schema";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const parsed = parseOrderListSearchParams(new URL(request.url).searchParams);
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  return mobileOk(await getOrders(parsed.data));
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;
  if (
    !validateOfflineReplayActor({
      header: request.headers.get(OFFLINE_ACTOR_HEADER),
      principalId: gate.principalId ?? gate.userId,
      actorId: gate.userId,
    })
  ) {
    return mobileError("offline.actorMismatch", 403);
  }

  const body = (await readJson(request)) as CreateOrderInput | null;
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const value = parsed.data;

  let trustedItems;
  try {
    trustedItems = await normalizeOrderItems(value.items, value.priceBookId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      ["PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "INVALID_ITEMS"].includes(message)
    ) {
      return mobileError("errors.invalidData");
    }
    throw error;
  }
  let requirement;
  try {
    const prefs = await getRawStorePrefs();
    requirement = evaluateOrderApprovalRequirement({
      clientId: value.clientId,
      rawItems: value.items,
      trustedItems,
      orderDiscount: value.discount,
      maxDiscountPercent: prefs.security.maxDiscountPercent,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "SENSITIVE_ORDER_REQUIRES_CLIENT_ID"
    ) {
      return mobileError("errors.invalidData");
    }
    throw error;
  }
  if (requirement) {
    const authorization = await authorizeMobileSensitiveAction({
      request,
      storeId: gate.storeId,
      requesterId: gate.userId,
      requesterRole: gate.role,
      permission: requirement.permission,
      scope: requirement.scope,
    });
    if (!authorization.ok) return mobileError(authorization.error, 403);
  }

  return mobileAction(await createOrderForUser(gate.userId, value));
}
