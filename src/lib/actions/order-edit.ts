"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, requireManager } from "./common";
import { Routes } from "@/lib/routes";
import { type UpdateOrderInput } from "@/lib/schemas/order";
import { updateOrderForUser, mergeOrdersForUser } from "@/lib/orders/edit";

export type { UpdateOrderInput } from "@/lib/schemas/order";

/** Sửa đơn đã bán (chưa hủy/chưa trả hàng). Lõi: src/lib/orders/edit.ts. */
export async function updateOrder(input: UpdateOrderInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await updateOrderForUser(gate.userId, input);
  if (result.ok) {
    revalidatePath(Routes.order(input.orderId));
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Inventory);
  }
  return result;
}

/** Gộp nhiều đơn cùng khách thành 1 đơn. Lõi: src/lib/orders/edit.ts. */
export async function mergeOrders(orderIds: string[]): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await mergeOrdersForUser(gate.userId, orderIds);
  if (result.ok) revalidatePath(Routes.Orders);
  return result;
}
