import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import { getOrders } from "@/lib/data/orders";
import { parseOrderListSearchParams } from "@/lib/orders/list-filter-schema";

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const parsed = parseOrderListSearchParams(new URL(request.url).searchParams);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    data: await getOrders(gate.storeId, { ...parsed.data, documentType: "sale", walkIn: true }),
  });
}
