import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerConsentEvents, customerConsents, customers } from "@/db/schema";
import {
  createCustomerSchema, updateCustomerSchema,
  type CreateCustomerInput, type UpdateCustomerInput,
} from "@/lib/schemas/order";
import { type ActionResult, generateCode, toMoney } from "@/lib/actions/common";
import { recordActivity } from "@/lib/audit/activity-log";

/**
 * Lõi tạo/sửa khách hàng — KHÔNG phải server action.
 * Dùng bởi server action (web). Không revalidate.
 */
export async function createCustomerCore(storeId: string, input: CreateCustomerInput, actorId: string | null): Promise<ActionResult<{ id: string }>> {
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(customers).values({
        storeId,
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
      }).returning({ id: customers.id, code: customers.code, name: customers.name });

      const purposes = v.consentStatus === "withdrawn"
        ? Object.fromEntries(Object.keys(v.consentPurposes).map((key) => [key, false]))
        : v.consentPurposes;
      await tx.insert(customerConsents).values({
        storeId,
        customerId: created.id,
        status: v.consentStatus,
        purposes,
        source: v.consentSource,
      });
      await tx.insert(customerConsentEvents).values({
        storeId,
        customerId: created.id,
        status: v.consentStatus,
        purposes,
        source: v.consentSource,
      });
      await recordActivity(tx, {
        storeId, actorId, action: "customer.created", entityType: "customer", entityId: created.id,
        after: { code: created.code, name: created.name, type: v.type, debtLimit: v.debtLimit, consentStatus: v.consentStatus },
      });
      return created;
    });
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("createCustomerCore failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateCustomerCore(storeId: string, input: UpdateCustomerInput, actorId: string | null): Promise<ActionResult> {
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(customers)
        .where(and(eq(customers.storeId, storeId), eq(customers.id, v.id))).limit(1).for("update");
      if (!current) throw new Error("CUSTOMER_NOT_FOUND");
      const next = {
        name: v.name,
        phone: v.phone?.slice(0, 20) || null,
        zaloUserId: v.zaloUserId || null,
        email: v.email || null,
        address: v.address || null,
        type: v.type,
        taxCode: v.taxCode?.slice(0, 30) || null,
        debtLimit: toMoney(v.debtLimit) ?? 0,
        note: v.note || null,
      };
      const changedFields = (Object.keys(next) as Array<keyof typeof next>).filter((key) => current[key] !== next[key]);
      if (!changedFields.length) return;
      await tx.update(customers).set(next).where(and(eq(customers.storeId, storeId), eq(customers.id, v.id)));
      await recordActivity(tx, {
        storeId, actorId, action: "customer.updated", entityType: "customer", entityId: v.id,
        before: { code: current.code, name: current.name, type: current.type, debtLimit: current.debtLimit },
        after: { code: current.code, name: next.name, type: next.type, debtLimit: next.debtLimit },
        metadata: { changedFields },
      });
    });
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateCustomerCore failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
