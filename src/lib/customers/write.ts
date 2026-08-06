import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerConsentEvents, customerConsents, customers } from "@/db/schema";
import {
  createCustomerSchema, updateCustomerSchema,
  type CreateCustomerInput, type UpdateCustomerInput,
} from "@/lib/schemas/order";
import { type ActionResult, generateCode, toMoney } from "@/lib/actions/common";

/**
 * Lõi tạo/sửa khách hàng — KHÔNG phải server action.
 * Dùng bởi server action (web). Không revalidate.
 */
export async function createCustomerCore(input: CreateCustomerInput): Promise<ActionResult<{ id: string }>> {
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(customers).values({
        code: generateCode("KH"),
        name: v.name.trim(),
        phone: v.phone?.trim() || null,
        zaloUserId: v.zaloUserId || null,
        email: v.email || null,
        address: v.address?.trim() || null,
        type: v.type,
        taxCode: v.taxCode?.trim() || null,
        debtLimit: toMoney(v.debtLimit),
        note: v.note || null,
      }).returning({ id: customers.id });

      const purposes = v.consentStatus === "withdrawn"
        ? Object.fromEntries(Object.keys(v.consentPurposes).map((key) => [key, false]))
        : v.consentPurposes;
      await tx.insert(customerConsents).values({
        customerId: created.id,
        status: v.consentStatus,
        purposes,
        source: v.consentSource,
      });
      await tx.insert(customerConsentEvents).values({
        customerId: created.id,
        status: v.consentStatus,
        purposes,
        source: v.consentSource,
      });
      return created;
    });
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("createCustomerCore failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateCustomerCore(input: UpdateCustomerInput): Promise<ActionResult> {
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.update(customers).set({
      name: v.name,
      phone: v.phone?.slice(0, 20) || null,
      zaloUserId: v.zaloUserId || null,
      email: v.email || null,
      address: v.address || null,
      type: v.type,
      taxCode: v.taxCode?.slice(0, 30) || null,
      debtLimit: toMoney(v.debtLimit) ?? 0,
      note: v.note || null,
    }).where(eq(customers.id, v.id));
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateCustomerCore failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
