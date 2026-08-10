import { NextResponse } from "next/server";
import { requireStockAccess } from "@/lib/actions/common";
import { getSupplierPreview } from "@/lib/data/partners";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireStockAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const { id } = await params;
  const preview = await getSupplierPreview(gate.storeId, id);
  if (!preview) {
    return NextResponse.json({ ok: false, error: "errors.notFound" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: preview });
}
