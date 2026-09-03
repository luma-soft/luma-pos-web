import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customerConsentEvents, customerConsents, customers } from "@/db/schema";
import { type ActionResult, getProfileId } from "@/lib/actions/common";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

const consentStatusSchema = z.enum(["pending", "granted", "withdrawn"]);

const updateCustomerConsentSchema = z.object({
  status: consentStatusSchema.optional(),
  purposes: z.record(z.string(), z.boolean()).default({}),
  source: z.string().trim().max(40).default("mobile"),
  note: z.string().trim().optional(),
});

export type UpdateCustomerConsentInput = z.input<
  typeof updateCustomerConsentSchema
>;

function normalizeConsent(input: z.output<typeof updateCustomerConsentSchema>) {
  const status =
    input.status ??
    (Object.values(input.purposes).some(Boolean) ? "granted" : "withdrawn");
  const purposes =
    status === "withdrawn"
      ? Object.fromEntries(Object.keys(input.purposes).map((key) => [key, false]))
      : input.purposes;

  return {
    status,
    purposes,
    source: input.source || "mobile",
    note: input.note || null,
  };
}

export async function updateCustomerConsentCore(
  customerId: string,
  input: UpdateCustomerConsentInput,
  userId: string,
): Promise<ActionResult<{ status: string; purposes: Record<string, boolean> }>> {
  const parsed = updateCustomerConsentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  const normalized = normalizeConsent(parsed.data);

  try {
    const context = await resolveStoreContextForUser(userId);
    if (!context) return { ok: false, error: "errors.unauthorized" };
    const profileId = await getProfileId(userId);

    await db.transaction(async (tx) => {
      const [customer] = await tx.select({ code: customers.code, name: customers.name }).from(customers)
        .where(and(eq(customers.storeId, context.storeId), eq(customers.id, customerId))).limit(1).for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      const [current] = await tx.select().from(customerConsents).where(and(eq(customerConsents.storeId, context.storeId), eq(customerConsents.customerId, customerId))).limit(1);
      const purposesChanged = !current || [...new Set([...Object.keys(current.purposes ?? {}), ...Object.keys(normalized.purposes)])]
        .some((key) => current.purposes?.[key] !== normalized.purposes[key]);
      if (current && current.status === normalized.status && !purposesChanged && current.source === normalized.source && current.note === normalized.note) return;
      await tx
        .insert(customerConsents)
        .values({
          storeId: context.storeId,
          customerId,
          status: normalized.status,
          purposes: normalized.purposes,
          source: normalized.source,
          note: normalized.note,
          updatedBy: profileId,
        })
        .onConflictDoUpdate({
          target: customerConsents.customerId,
          set: {
            status: normalized.status,
            purposes: normalized.purposes,
            source: normalized.source,
            note: normalized.note,
            updatedBy: profileId,
            updatedAt: sql`now()`,
          },
        });

      await tx.insert(customerConsentEvents).values({
        storeId: context.storeId,
        customerId,
        status: normalized.status,
        purposes: normalized.purposes,
        source: normalized.source,
        note: normalized.note,
        createdBy: profileId,
      });
      await recordActivity(tx, {
        storeId: context.storeId, actorId: profileId, action: "customer.consent.updated", entityType: "customer", entityId: customerId,
        before: current ? { code: customer.code, name: customer.name, consentStatus: current.status, purposes: current.purposes } : null,
        after: { code: customer.code, name: customer.name, consentStatus: normalized.status, purposes: normalized.purposes },
      });
    });

    return {
      ok: true,
      data: {
        status: normalized.status,
        purposes: normalized.purposes,
      },
    };
  } catch (e) {
    if (e instanceof Error && e.message === "CUSTOMER_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    console.error("updateCustomerConsentCore failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
