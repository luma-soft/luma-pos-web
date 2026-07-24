import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { OrderDetailDialog } from "@/components/order-detail-dialog";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "@/app/(app)/orders/[id]/order-detail-panel";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OrderModalCatchAll({ searchParams }: Props) {
  const query = await searchParams;
  const orderId = typeof query.detailOrderId === "string" ? query.detailOrderId : null;
  if (!orderId) return null;

  const order = await getOrder(orderId).catch(() => null);
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
