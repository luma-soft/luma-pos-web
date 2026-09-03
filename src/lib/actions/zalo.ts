"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { type ActionResult, requireSalesAccess } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { sendZaloMessage } from "@/lib/zalo/send";

export async function sendCustomerPortalZalo(input: {
  customerId: string;
  url: string;
}): Promise<ActionResult<{ messageId: string | null }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const result = await sendZaloMessage({
    kind: "portal_link",
    storeId: gate.storeId,
    customerId: input.customerId,
    url: input.url,
    actorId: gate.userId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(Routes.customer(input.customerId));
  return result;
}

export async function sendOrderInvoiceZalo(input: {
  orderId: string;
  url?: string;
}): Promise<ActionResult<{ messageId: string | null }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const result = await sendZaloMessage({
    kind: "invoice",
    storeId: gate.storeId,
    orderId: input.orderId,
    url: input.url,
    actorId: gate.userId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(Routes.order(input.orderId));
  return result;
}
