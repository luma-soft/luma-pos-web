import type { orders, orderItems } from "@/db/schema";

type OrderSnapshot = Partial<typeof orders.$inferSelect>;

/** Keep activity readable and stable without persisting internal order/provider data. */
export function orderActivitySnapshot(order: OrderSnapshot) {
  return {
    code: order.code,
    documentType: order.documentType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: Number(order.total ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    discount: Number(order.discount ?? 0),
    shippingFee: Number(order.shippingFee ?? 0),
    projectName: order.projectName ?? null,
    note: order.note ?? null,
  };
}

export function orderItemActivitySnapshot(items: Pick<typeof orderItems.$inferSelect,
  "productId" | "productName" | "unitName" | "quantity" | "unitPrice"
>[]) {
  return items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    unitName: item.unitName,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
  }));
}

export function orderActivityType(order: Pick<OrderSnapshot, "documentType" | "status">) {
  if (order.documentType === "quote" || order.status === "quote") return "quote";
  if (order.documentType === "booking" || order.status === "confirmed") return "booking";
  return "order";
}
