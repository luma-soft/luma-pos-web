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
  if (!gate.ok) return mobileGate(gate)!;

  const parsed = parseOrderListSearchParams(new URL(request.url).searchParams);
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  return mobileOk(await getOrders(gate.storeId, parsed.data));
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
    trustedItems = await normalizeOrderItems(gate.storeId, value.items, value.priceBookId, gate.role);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (value.expectedPricing && ["PRICE_BOOK_PRICE_UNAVAILABLE", "PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "PRICE_BOOK_NOT_FOUND"].includes(message)) {
      return mobileError("pos.errors.pricingChanged", 409);
    }
    if (message === "PRICE_BOOK_PRICE_UNAVAILABLE") return mobileError("pricing.errors.priceUnavailable");
    if (message === "PRICE_BOOK_FORBIDDEN") return mobileError("errors.forbidden", 403);
    if (
      ["PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "INVALID_ITEMS", "PRICE_BOOK_NOT_FOUND"].includes(message)
    ) {
      return mobileError("errors.invalidData");
    }
    throw error;
  }
  let requirement;
  try {
    const prefs = await getRawStorePrefs(gate.storeId);
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

  const result = await createOrderForUser(gate.userId, value, { items: trustedItems });
  if (!result.ok && result.error === "pos.errors.pricingChanged") return mobileError(result.error, 409);
  return mobileAction(result);
}
