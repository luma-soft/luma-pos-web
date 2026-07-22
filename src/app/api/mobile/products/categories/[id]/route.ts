import { deleteCategory, updateCategory } from "@/lib/actions/products";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body || typeof body !== "object") return mobileAction({ ok: false, error: "errors.invalidData" });
  const input = body as { name?: unknown; parentId?: unknown };
  return mobileAction(await updateCategory((await params).id, {
    ...(input.name !== undefined ? { name: String(input.name) } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId ? String(input.parentId) : null } : {}),
  }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  return mobileAction(await deleteCategory((await params).id));
}
