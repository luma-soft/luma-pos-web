import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { requireSalesAccess } from "@/lib/actions/common";
import { getOrder } from "@/lib/data/orders";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSalesAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "errors.forbidden" ? 403 : 401 });

  const { id } = await params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ ok: false, error: "errors.notFound" }, { status: 404 });
  const [einvoice] = await db
    .select({
      id: einvoices.id,
      status: einvoices.status,
      serial: einvoices.serial,
      number: einvoices.number,
      buyerName: einvoices.buyerName,
      vatRate: einvoices.vatRate,
      vatAmount: einvoices.vatAmount,
      issuedAt: einvoices.issuedAt,
    })
    .from(einvoices)
    .where(eq(einvoices.orderId, id))
    .limit(1);

  return NextResponse.json({ ok: true, data: { order, einvoice: einvoice ?? null } });
}
