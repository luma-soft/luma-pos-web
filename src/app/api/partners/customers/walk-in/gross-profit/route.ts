import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import { getWalkInGrossProfit } from "@/lib/data/partners";

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const search = new URL(request.url).searchParams;
  const grossProfit = await getWalkInGrossProfit(gate.storeId, {
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  return NextResponse.json({ ok: true, data: { grossProfit } });
}
