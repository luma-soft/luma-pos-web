import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import {
  getOrders,
} from "@/lib/data/orders";
import { parseOrderListSearchParams } from "@/lib/orders/list-filter-schema";

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const params = new URL(request.url).searchParams;
  const parsed = parseOrderListSearchParams(params);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Bộ lọc không hợp lệ", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { total } = await getOrders(gate.storeId, {
    ...parsed.data,
    page: 1,
    pageSize: 1,
  });

  return NextResponse.json(
    { ok: true, data: { total } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
