import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import { getCustomerGrossProfit } from "@/lib/data/partners";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const grossProfit = await getCustomerGrossProfit(gate.storeId, id, {
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  if (grossProfit === null) {
    return NextResponse.json({ ok: false, error: "errors.notFound" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data: { grossProfit } });
}
