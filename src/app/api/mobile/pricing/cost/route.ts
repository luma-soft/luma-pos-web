import { setProductCostPrice } from "@/lib/actions/price-books";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const payload = body as Record<string, unknown>;
  if (typeof payload.productId !== "string" || !payload.productId.trim()) {
    return mobileError("errors.invalidData");
  }
  return mobileAction(await setProductCostPrice(body as Parameters<typeof setProductCostPrice>[0]));
}
