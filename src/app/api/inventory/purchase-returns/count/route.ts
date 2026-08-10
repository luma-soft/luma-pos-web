import { NextResponse } from "next/server";
import { requireStockAccess } from "@/lib/actions/common";
import { getPurchaseReturns } from "@/lib/data/purchase-returns";

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "errors.forbidden" ? 403 : 401 });
  const params = new URL(request.url).searchParams;
  const result = await getPurchaseReturns(gate.storeId, {
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    settlement: params.get("settlement") ?? undefined,
    supplierId: params.get("supplierId") ?? undefined,
    warehouseId: params.get("warehouseId") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    page: 1,
    pageSize: 1,
  });
  return NextResponse.json({ ok: true, data: { total: result.total } }, { headers: { "Cache-Control": "private, no-store" } });
}
