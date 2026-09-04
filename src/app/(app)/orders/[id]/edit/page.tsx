import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { OrderEditForm } from "./order-edit-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export default async function OrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireStoreContext();
  const order = await getOrder(context.storeId, id).catch(() => null);
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
        items: order.items.map((i) => {
          const pricing = readOrderLinePricing(i);
          return {
            productId: i.productId,
            productName: i.productName,
            unitName: i.unitName,
            unitMultiplier: Number(i.unitMultiplier),
            quantity: Number(i.quantity),
            unitPrice: pricing.netUnitPrice,
            preDiscountUnitPrice: pricing.unitPrice,
            lineDiscount: pricing.lineDiscount,
            lineDiscountMode: pricing.lineDiscountMode,
            lineDiscountValue: pricing.lineDiscountValue,
            priceBookId: i.priceBookId,
          };
        }),
      }}
    />
  );
}
