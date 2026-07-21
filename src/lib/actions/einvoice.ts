"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices, orders, storeSettings } from "@/db/schema";
import { type ActionResult, requireUser, toMoney } from "./common";
import { Routes } from "@/lib/routes";
import { issueEInvoiceSchema, type IssueEInvoiceInput } from "@/lib/schemas/einvoice";
import { processEInvoiceRequest } from "@/lib/einvoice/worker";
import {
  resetEInvoiceRetryBudgetForManualSubmission,
  selectEInvoiceIssuanceProvider,
} from "@/lib/einvoice/provider";
import { deriveEInvoiceFallbackVatRate } from "@/lib/einvoice/tax";

type EInvoiceRequestResult = {
  status: "issued" | "queued" | "processing";
  number: string | null;
  nextAttemptAt?: string;
};

export async function issueEInvoice(input: IssueEInvoiceInput): Promise<ActionResult<EInvoiceRequestResult>> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  return issueEInvoiceForUser(input);
}

export async function issueEInvoiceForUser(input: IssueEInvoiceInput): Promise<ActionResult<EInvoiceRequestResult>> {
  const parsed = issueEInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, v.orderId)).limit(1);
    if (!order) return { ok: false, error: "errors.invalidData" };
    if (order.status !== "completed") return { ok: false, error: "einvoice.errors.onlyCompleted" };

    const [existing] = await db.select().from(einvoices).where(eq(einvoices.orderId, v.orderId)).limit(1);
    if (existing?.status === "issued") return { ok: false, error: "einvoice.errors.alreadyIssued" };
    if (existing?.status === "processing") {
      return { ok: true, data: { status: "processing", number: null } };
    }

    const [requestOwner] = await db
      .select({ orderId: einvoices.orderId })
      .from(einvoices)
      .where(eq(einvoices.requestId, v.requestId))
      .limit(1);
    if (requestOwner && requestOwner.orderId !== v.orderId) {
      return { ok: false, error: "einvoice.errors.requestConflict" };
    }

    const total = Number(order.total);
    const fallbackVatRate = v.vatRate ?? deriveEInvoiceFallbackVatRate({
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      tax: Number(order.tax),
    });
    const rate = fallbackVatRate / 100;
    const totalBeforeVat = total / (1 + rate);
    const vatAmount = total - totalBeforeVat;

    const [settings] = await db.select({ prefs: storeSettings.prefs })
      .from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const taxPrefs = settings?.prefs?.tax;
    const providerSelection = selectEInvoiceIssuanceProvider({
      einvoiceEnabled: taxPrefs?.einvoiceEnabled,
      einvoiceProvider: taxPrefs?.einvoiceProvider,
    });
    if (!providerSelection.ok) {
      return { ok: false, error: providerSelection.error };
    }
    const provider = providerSelection.provider;
    const queuedAt = new Date();
    const retryState = existing
      ? resetEInvoiceRetryBudgetForManualSubmission(existing)
      : { attemptCount: 0, lastAttemptAt: null, lastError: null };
    const values = {
      orderId: v.orderId,
      status: "queued" as const,
      serial: null,
      number: null,
      buyerName: v.buyerName,
      buyerTaxCode: v.buyerTaxCode?.trim() || null,
      buyerAddress: v.buyerAddress?.trim() || null,
      buyerEmail: v.buyerEmail?.trim() || null,
      provider,
      requestId: v.requestId,
      vatRate: String(fallbackVatRate),
      totalBeforeVat: toMoney(totalBeforeVat),
      vatAmount: toMoney(vatAmount),
      attemptCount: retryState.attemptCount,
      lastAttemptAt: retryState.lastAttemptAt,
      nextAttemptAt: queuedAt,
      queuedAt,
      lockedAt: null,
      lockToken: null,
      lastError: retryState.lastError,
      providerReference: null,
      issuedAt: null,
      updatedAt: queuedAt,
      note: null,
    };
    let invoiceId: string;
    if (existing) {
      await db.update(einvoices).set(values).where(eq(einvoices.id, existing.id));
      invoiceId = existing.id;
    } else {
      const [created] = await db
        .insert(einvoices)
        .values(values)
        .returning({ id: einvoices.id });
      invoiceId = created.id;
    }

    const processed = await processEInvoiceRequest(invoiceId);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.EInvoices);
    revalidatePath(Routes.order(v.orderId));
    if (!processed.ok) return { ok: false, error: processed.error };
    return {
      ok: true,
      data: {
        status: processed.status,
        number: processed.number,
        ...(processed.status === "queued"
          ? { nextAttemptAt: processed.nextAttemptAt.toISOString() }
          : {}),
      },
    };
  } catch (e) {
    console.error("issueEInvoice failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
