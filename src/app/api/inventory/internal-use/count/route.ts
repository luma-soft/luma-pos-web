import { NextResponse } from "next/server";
import { requireStockAccess } from "@/lib/actions/common";
import { getInternalUseIssueCount } from "@/lib/data/internal-use";

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }
  const params = new URL(request.url).searchParams;
  const total = await getInternalUseIssueCount(gate.storeId, {
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    warehouseId: params.get("warehouseId") ?? undefined,
    reason: params.get("reason") ?? undefined,
    department: params.get("department") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  return NextResponse.json(
    { ok: true, data: { total } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
