import { notFound } from "next/navigation";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { OrderEditForm } from "./order-edit-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { Routes } from "@/lib/routes";
import { getTranslations } from "next-intl/server";
import { EditBlockedNotice } from "@/components/edit-blocked-notice";

export default async function OrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireStoreContext();
  const order = await getOrder(context.storeId, id).catch(() => null);
  if (!order) notFound();
  if (order.replacedByOrderId || (order.status !== "completed" && order.status !== "quote") || order.returns.length > 0) {
    const t = await getTranslations("orderEdit.errors");
    return (
      <EditBlockedNotice
        code={order.code}
        documentHref={Routes.order(order.id)}
        replacementHref={order.replacedByOrderId ? Routes.order(order.replacedByOrderId) : null}
        message={order.returns.length > 0 ? t("hasReturns") : undefined}
      />
    );
  }

  return (
    <OrderEditForm
      orderId={order.id}
      orderCode={order.code}
      warehouseId={order.warehouseId}
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
