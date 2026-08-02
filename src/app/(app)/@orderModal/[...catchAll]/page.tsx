import { notFound } from "next/navigation";
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
  return (
    <OrderDetailDialog
      title={order.code}
      subtitle={order.customerName ?? "Khách lẻ"}
    >
      <OrderDetailPanel order={order} compact />
    </OrderDetailDialog>
  );
}
