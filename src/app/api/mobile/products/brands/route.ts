import { createBrand } from "@/lib/actions/products";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  const name =
    body && typeof body === "object"
      ? String((body as { name?: unknown }).name ?? "")
      : "";
  return mobileAction(await createBrand(name));
}
