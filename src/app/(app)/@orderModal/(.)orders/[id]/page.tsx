import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { OrderDetailDialog } from "@/components/order-detail-dialog";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "@/app/(app)/orders/[id]/order-detail-panel";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailModalPage({ params }: Props) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  const [einvoice] = await db
    .select()
    .from(einvoices)
    .where(eq(einvoices.orderId, order.id))
    .limit(1);

  return (
    <OrderDetailDialog
      title={order.code}
      subtitle={order.customerName ?? "Khách lẻ"}
    >
      <OrderDetailPanel order={order} einvoice={einvoice ?? null} compact />
    </OrderDetailDialog>
  );
}
