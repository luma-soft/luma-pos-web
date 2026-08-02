"use server";

import { requireManager, requireSalesAccess, type ActionResult } from "@/lib/actions/common";
import {
  collectCustomerReceivableForUser,
  createCustomerReceivableEntryForUser,
} from "@/lib/receivables/service";
import type { CollectReceivableInput, ReceivableEntryInput } from "@/lib/receivables/service-core";

export async function collectCustomerReceivable(input: CollectReceivableInput): Promise<ActionResult<{ receiptId: string; replayed: boolean }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const result = await collectCustomerReceivableForUser(gate.userId, input);
  return result.ok ? { ok: true, data: { receiptId: result.data.receiptId, replayed: result.data.replayed } } : result;
}

export async function createCustomerReceivableEntry(input: ReceivableEntryInput): Promise<ActionResult<{ entryId: string; replayed: boolean }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await createCustomerReceivableEntryForUser(gate.userId, input);
  return result.ok ? { ok: true, data: { entryId: result.data.entryId, replayed: result.data.replayed } } : result;
}
