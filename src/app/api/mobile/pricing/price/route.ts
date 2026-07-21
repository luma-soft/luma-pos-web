import { setProductPrice } from "@/lib/actions/price-books";
import { authorizeMobileSensitiveAction } from "@/lib/auth/mobile-approval";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const payload = body as Record<string, unknown>;
  const productId = payload.productId?.toString().trim() ?? "";
  const priceBookId = payload.priceBookId?.toString().trim() ?? "";
  if (!productId || !priceBookId) return mobileError("errors.invalidData");
  const authorization = await authorizeMobileSensitiveAction({
    request,
    requesterId: gate.userId,
    requesterRole: gate.role,
    permission: "price.override",
    scope: `price:${productId}:${priceBookId}`,
  });
  if (!authorization.ok) return mobileError(authorization.error, 403);

  return mobileAction(
    await setProductPrice(body as Parameters<typeof setProductPrice>[0]),
  );
}
