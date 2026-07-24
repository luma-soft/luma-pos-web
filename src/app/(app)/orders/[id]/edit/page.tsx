import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { OrderEditForm } from "./order-edit-form";

export default async function OrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order || (order.status !== "completed" && order.status !== "quote") || order.returns.length > 0) notFound();

  return (
    <OrderEditForm
      orderId={order.id}
      orderCode={order.code}
      initial={{
        projectName: order.projectName ?? "",
        note: order.note ?? "",
        discount: Number(order.discount),
        shippingFee: Number(order.shippingFee),
        amountPaid: Number(order.amountPaid),
        items: order.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          unitName: i.unitName,
          unitMultiplier: Number(i.unitMultiplier),
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
      }}
    />
  );
}
