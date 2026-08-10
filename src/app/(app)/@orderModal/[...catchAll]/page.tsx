import { notFound } from "next/navigation";
import { OrderDetailDialog } from "@/components/order-detail-dialog";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "@/app/(app)/orders/[id]/order-detail-panel";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OrderModalCatchAll({ searchParams }: Props) {
  const query = await searchParams;
  const orderId = typeof query.detailOrderId === "string" ? query.detailOrderId : null;
  if (!orderId) return null;

  const context = await requireStoreContext();
  const order = await getOrder(context.storeId, orderId).catch(() => null);
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
