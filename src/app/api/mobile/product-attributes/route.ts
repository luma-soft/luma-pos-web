import { createProductAttribute, getProductAttributes } from "@/lib/actions/product-attributes";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;
  return mobileAction(await getProductAttributes());
}
export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request) as { name?: unknown } | null;
  if (typeof body?.name !== "string") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await createProductAttribute(body.name));
}
