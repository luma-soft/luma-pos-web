import { setProductPrice } from "@/lib/actions/price-books";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const payload = body as Record<string, unknown>;
  const productId = payload.productId?.toString().trim() ?? "";
  const priceBookId = payload.priceBookId?.toString().trim() ?? "";
  if (!productId || !priceBookId) return mobileError("errors.invalidData");
  return mobileAction(
    await setProductPrice(body as Parameters<typeof setProductPrice>[0]),
  );
}
