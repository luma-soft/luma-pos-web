"use server";

import type { CreateCustomerOutput } from "@/lib/schemas/order";
import { createCustomerCore } from "@/lib/customers/write";
import { type ActionResult, requireSalesAccess } from "./common";

/**
 * Create a customer from checkout without invalidating the app shell.
 * The POS inserts the returned customer into its local picker immediately.
 */
export async function createPosCustomer(
  input: CreateCustomerOutput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  return createCustomerCore(gate.storeId, input, gate.userId);
}
