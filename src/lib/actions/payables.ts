"use server";

import { requireManager, type ActionResult } from "@/lib/actions/common";
import {
  createSupplierPayableEntryForUser,
  paySupplierPayableForUser,
} from "@/lib/payables/service";
import type {
  PaySupplierInput,
  SupplierPayableEntryInput,
} from "@/lib/payables/service-core";

export async function paySupplierPayable(
  input: PaySupplierInput,
): Promise<ActionResult<{ receiptId: string; replayed: boolean }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await paySupplierPayableForUser(gate.userId, input);
  return result.ok
    ? { ok: true, data: { receiptId: result.data.receiptId, replayed: result.data.replayed } }
    : result;
}

export async function createSupplierPayableEntry(
  input: SupplierPayableEntryInput,
): Promise<ActionResult<{ entryId: string; replayed: boolean }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await createSupplierPayableEntryForUser(gate.userId, input);
  return result.ok
    ? { ok: true, data: { entryId: result.data.entryId, replayed: result.data.replayed } }
    : result;
}
