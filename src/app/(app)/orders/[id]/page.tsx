import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "./order-detail-panel";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  const [einvoice] = await db
    .select()
    .from(einvoices)
    .where(eq(einvoices.orderId, order.id))
    .limit(1);

  return (
    <div className="p-4 sm:p-6">
      <OrderDetailPanel order={order} einvoice={einvoice ?? null} />
    </div>
  );
}
