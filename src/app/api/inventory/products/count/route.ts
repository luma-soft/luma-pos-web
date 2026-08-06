import { NextResponse } from "next/server";
import { requireStockAccess } from "@/lib/actions/common";
import { getProducts } from "@/lib/data/products";

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "errors.forbidden" ? 403 : 401 });
  const params = new URL(request.url).searchParams;
  const result = await getProducts({
    q: params.get("q") ?? undefined,
    categoryId: params.get("categoryId") ?? undefined,
    brandId: params.get("brandId") ?? undefined,
    supplierId: params.get("supplierId") ?? undefined,
    productKind: (params.get("productKind") as "product" | "service" | "combo" | null) ?? undefined,
    status: (params.get("status") as "active" | "inactive" | "draft" | "archived" | "all" | null) ?? "active",
    stock: (params.get("stock") as "instock" | "low" | "out" | null) ?? undefined,
    sort: (params.get("sort") as "name" | "stock" | "updated" | null) ?? undefined,
    view: (params.get("view") as "grouped" | "flat" | null) ?? "grouped",
    page: 1,
    pageSize: 1,
  });
  return NextResponse.json({ ok: true, data: { total: result.total } }, { headers: { "Cache-Control": "private, no-store" } });
}
