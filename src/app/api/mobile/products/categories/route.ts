import { createCategory, createCategoryNode } from "@/lib/actions/products";
import { getCategoriesWithCounts } from "@/lib/data/categories";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page")) || 1;
  const pageSize = Number(url.searchParams.get("pageSize")) || 100;
  return Response.json({ ok: true, data: await getCategoriesWithCounts({ page, pageSize }) });
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  const name =
    body && typeof body === "object"
      ? String((body as { name?: unknown }).name ?? "")
      : "";
  const parentId = body && typeof body === "object" ? String((body as { parentId?: unknown }).parentId ?? "") : "";
  return mobileAction(parentId ? await createCategoryNode({ name, parentId }) : await createCategory(name));
}
