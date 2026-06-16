"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, suppliers } from "@/db/schema";
import {
  createSupplierSchema,
  updateCustomerSchema, type UpdateCustomerInput,
  type CreateCustomerOutput, type CreateSupplierOutput,
} from "@/lib/schemas/order";
import { type ActionResult, generateCode, requireUser, requireManager, requireStockAccess, toMoney } from "./common";
import { createCustomerCore, updateCustomerCore } from "@/lib/customers/write";
import { Routes } from "@/lib/routes";

export async function createCustomer(
  input: CreateCustomerOutput
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  // Lõi tách riêng. Xem src/lib/customers/write.ts.
  const result = await createCustomerCore(input);
  if (result.ok) revalidatePath(Routes.Customers);
  return result;
}

const updateSupplierSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  address: z.string().trim().optional(),
  taxCode: z.string().trim().optional(),
  note: z.string().trim().optional(),
});
export type UpdateSupplierInput = z.input<typeof updateSupplierSchema>;

export async function updateSupplier(input: UpdateSupplierInput): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.update(suppliers).set({
      name: v.name,
      phone: v.phone?.slice(0, 20) || null,
      email: v.email || null,
      address: v.address || null,
      taxCode: v.taxCode?.slice(0, 30) || null,
      note: v.note || null,
    }).where(eq(suppliers.id, v.id));
    revalidatePath(Routes.Suppliers);
    revalidatePath(`/suppliers/${v.id}`);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateSupplier failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export type { UpdateCustomerInput } from "@/lib/schemas/order";

export async function updateCustomer(input: UpdateCustomerInput): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  // Lõi tách riêng. Xem src/lib/customers/write.ts.
  const result = await updateCustomerCore(input);
  if (result.ok) {
    revalidatePath(Routes.Customers);
    revalidatePath(`/customers/${input.id}`);
  }
  return result;
}

export async function createSupplier(
  input: CreateSupplierOutput
): Promise<ActionResult<{ id: string }>> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const [row] = await db.insert(suppliers).values({
      code: generateCode("NCC"),
      name: v.name.trim(),
      phone: v.phone?.trim() || null,
      address: v.address?.trim() || null,
      taxCode: v.taxCode?.trim() || null,
      note: v.note || null,
    }).returning({ id: suppliers.id });

    revalidatePath(Routes.Suppliers);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("createSupplier failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
