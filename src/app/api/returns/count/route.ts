import { NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/actions/common";
import { getReturns } from "@/lib/data/returns";
import { parseReturnListSearchParams } from "@/lib/returns/list-filter-schema";

export async function GET(request: Request) {
  const gate = await requireSalesAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const parsed = parseReturnListSearchParams(new URL(request.url).searchParams);
  if (!parsed.success) {
    const invalidReason = parsed.error.issues.some((issue) => issue.path[0] === "reason");
    return NextResponse.json(
      {
        ok: false,
        error: invalidReason ? "Lý do trả hàng không hợp lệ" : "Bộ lọc không hợp lệ",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { total } = await getReturns(gate.storeId, {
    ...parsed.data,
    page: 1,
    pageSize: 1,
  });
  return NextResponse.json(
    { ok: true, data: { total } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
