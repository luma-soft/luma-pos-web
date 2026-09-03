import { deleteProductAttribute, renameProductAttribute } from "@/lib/actions/product-attributes";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const body = await readJson(request) as { name?: unknown } | null;
  if (typeof body?.name !== "string") return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await renameProductAttribute((await context.params).id, body.name));
}
export async function DELETE(_request: Request, context: Context) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;
  return mobileAction(await deleteProductAttribute((await context.params).id));
}
