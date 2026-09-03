import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  einvoices,
  orderItems,
  orders,
  products,
  storeFeatures,
  storeSettings,
} from "@/db/schema";
import {
  executeEInvoiceAttempt,
  resolveEInvoiceProviderAdapter,
  selectEInvoiceIssuanceProvider,
  type EInvoiceProviderAdapter,
  type EInvoiceProviderRequest,
} from "@/lib/einvoice/provider";
import { recordActivity } from "@/lib/audit/activity-log";

const lockTimeoutMs = 5 * 60_000;

export type EInvoiceProcessingResult =
  | { ok: true; status: "issued"; number: string }
  | { ok: true; status: "queued"; number: null; nextAttemptAt: Date }
  | { ok: false; status: "error" | "skipped"; error: string };

type AdapterResolver = (
  provider: string | null | undefined,
) => EInvoiceProviderAdapter | null;

export async function processEInvoiceRequest(
  invoiceId: string,
  options: {
    now?: Date;
    resolveAdapter?: AdapterResolver;
    storeId?: string;
  } = {},
): Promise<EInvoiceProcessingResult> {
  const now = options.now ?? new Date();
  const lockToken = randomUUID();
  const [claimed] = await db
    .update(einvoices)
    .set({
      status: "processing",
      lockedAt: now,
      lockToken,
      updatedAt: now,
    })
    .where(and(
      eq(einvoices.id, invoiceId),
      ...(options.storeId ? [eq(einvoices.storeId, options.storeId)] : []),
      eq(einvoices.status, "queued"),
      or(isNull(einvoices.nextAttemptAt), lte(einvoices.nextAttemptAt, now)),
    ))
    .returning();
  if (!claimed) {
    return {
      ok: false,
      status: "skipped",
      error: "einvoice.errors.notReady",
    };
  }

  let attemptResultReceived = false;
  try {
    const [order, settings, lines] = await Promise.all([
      db.select().from(orders).where(and(eq(orders.storeId, claimed.storeId), eq(orders.id, claimed.orderId))).limit(1),
      db.select().from(storeSettings).where(eq(storeSettings.storeId, claimed.storeId)).limit(1),
      db
        .select({
          name: orderItems.productName,
          unit: orderItems.unitName,
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          lineTotal: orderItems.total,
          productVatRate: products.vatRate,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(and(eq(orderItems.storeId, claimed.storeId), eq(orderItems.orderId, claimed.orderId))),
    ]);
    const orderRow = order[0];
    const store = settings[0];
    if (!orderRow || !store || lines.length === 0) {
      throw new Error("einvoice.errors.sourceDataMissing");
    }
    const sellerTaxCode =
      store.prefs?.tax?.einvoiceTaxId?.trim() || store.taxCode.trim();
    if (!sellerTaxCode || !store.name.trim() || !store.address.trim()) {
      throw new Error("einvoice.errors.sellerTaxInfoMissing");
    }
    const providerSelection = selectEInvoiceIssuanceProvider({
      einvoiceEnabled: store.prefs?.tax?.einvoiceEnabled,
      einvoiceProvider: store.prefs?.tax?.einvoiceProvider,
    });
    if (!providerSelection.ok) {
      throw new Error(providerSelection.error);
    }
    if (
      providerSelection.provider.toLocaleLowerCase("en") !==
      (claimed.provider?.trim() ?? "").toLocaleLowerCase("en")
    ) {
      throw new Error("einvoice.errors.providerChanged");
    }

    const request: EInvoiceProviderRequest = {
      requestId: claimed.requestId ?? claimed.id,
      orderId: claimed.orderId,
      buyerName: claimed.buyerName,
      buyerTaxCode: claimed.buyerTaxCode,
      buyerAddress: claimed.buyerAddress,
      buyerEmail: claimed.buyerEmail,
      vatRate: Number(claimed.vatRate),
      totalBeforeVat: Number(claimed.totalBeforeVat),
      vatAmount: Number(claimed.vatAmount),
      total: Number(orderRow.total),
      seller: {
        name: store.name,
        taxCode: sellerTaxCode,
        address: store.address,
      },
      lines: lines.map((line) => ({
        name: line.name,
        unit: line.unit,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        lineTotal: Number(line.lineTotal),
        vatRate: Number(line.productVatRate ?? claimed.vatRate),
      })),
    };
    const adapter = (options.resolveAdapter ?? resolveEInvoiceProviderAdapter)(
      claimed.provider,
    );
    const result = await executeEInvoiceAttempt({
      adapter,
      request,
      attemptCount: claimed.attemptCount,
      now,
    });
    attemptResultReceived = true;
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(einvoices).set({
        status: result.status,
        attemptCount: result.attemptCount,
        lastAttemptAt: now,
        nextAttemptAt: result.nextAttemptAt,
        lastError: result.error,
        number: result.number,
        serial: result.serial,
        providerReference: result.providerReference,
        issuedAt: result.issuedAt,
        lockedAt: null,
        lockToken: null,
        updatedAt: new Date(),
      }).where(and(eq(einvoices.storeId, claimed.storeId), eq(einvoices.id, claimed.id), eq(einvoices.lockToken, lockToken))).returning({ id: einvoices.id });
      if (updated) await recordActivity(tx, {
        storeId: claimed.storeId, actorId: null, source: "system",
        action: result.status === "issued" ? "einvoice.issued" : result.status === "queued" ? "einvoice.retry_scheduled" : "einvoice.failed",
        entityType: "order", entityId: claimed.orderId, status: result.status === "error" ? "failed" : "succeeded",
        before: { code: orderRow.code, status: "processing", attemptCount: claimed.attemptCount },
        after: {
          code: orderRow.code, status: result.status, number: result.number, serial: result.serial,
          buyerName: claimed.buyerName, total: Number(orderRow.total), provider: claimed.provider,
          attemptCount: result.attemptCount, nextAttemptAt: result.nextAttemptAt,
        },
        affectedRecords: [{ type: "order", id: claimed.orderId, code: orderRow.code }, { type: "einvoice", id: claimed.id }],
      });
    });

    if (result.status === "issued" && result.number) {
      return { ok: true, status: "issued", number: result.number };
    }
    if (result.status === "queued" && result.nextAttemptAt) {
      return {
        ok: true,
        status: "queued",
        number: null,
        nextAttemptAt: result.nextAttemptAt,
      };
    }
    return {
      ok: false,
      status: "error",
      error: result.error ?? "einvoice.errors.providerFailure",
    };
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("einvoice.")
      ? error.message
      : "errors.serverError";
    // A provider may already have issued the invoice. Keep its processing lease
    // when persistence fails so recovery uses the same provider request identity.
    if (attemptResultReceived) return { ok: false, status: "error", error: message };
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(einvoices).set({
        status: "error",
        attemptCount: claimed.attemptCount + 1,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastError: message,
        lockedAt: null,
        lockToken: null,
        updatedAt: new Date(),
      }).where(and(eq(einvoices.storeId, claimed.storeId), eq(einvoices.id, claimed.id), eq(einvoices.lockToken, lockToken))).returning({ id: einvoices.id });
      if (updated) {
        const [order] = await tx.select({ code: orders.code }).from(orders)
          .where(and(eq(orders.storeId, claimed.storeId), eq(orders.id, claimed.orderId))).limit(1);
        await recordActivity(tx, {
          storeId: claimed.storeId, actorId: null, source: "system", action: "einvoice.failed",
          entityType: "order", entityId: claimed.orderId, status: "failed",
          before: { code: order?.code, status: "processing", attemptCount: claimed.attemptCount },
          after: { code: order?.code, status: "error", buyerName: claimed.buyerName, provider: claimed.provider, attemptCount: claimed.attemptCount + 1 },
          metadata: { reason: message },
        });
      }
    });
    return { ok: false, status: "error", error: message };
  }
}

export async function processDueEInvoices(input: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
  const staleLock = new Date(now.getTime() - lockTimeoutMs);
  await db
    .update(einvoices)
    .set({
      status: "queued",
      lockedAt: null,
      lockToken: null,
      nextAttemptAt: now,
      lastError: "einvoice.errors.workerInterrupted",
      updatedAt: now,
    })
    .where(and(
      eq(einvoices.status, "processing"),
      sql`exists (select 1 from ${storeFeatures} sf where sf.store_id = ${einvoices.storeId} and sf.feature_key = 'einvoice' and sf.enabled = true)`,
      or(isNull(einvoices.lockedAt), lt(einvoices.lockedAt, staleLock)),
    ));

  const due = await db
    .select({ id: einvoices.id })
    .from(einvoices)
    .innerJoin(storeFeatures, and(
      eq(storeFeatures.storeId, einvoices.storeId),
      eq(storeFeatures.featureKey, "einvoice"),
      eq(storeFeatures.enabled, true),
    ))
    .where(and(
      inArray(einvoices.status, ["queued"]),
      or(isNull(einvoices.nextAttemptAt), lte(einvoices.nextAttemptAt, now)),
    ))
    .orderBy(sql`${einvoices.nextAttemptAt} asc nulls first`, einvoices.createdAt)
    .limit(limit);
  const results = [];
  for (const row of due) {
    results.push(await processEInvoiceRequest(row.id, { now }));
  }
  return {
    processed: results.length,
    issued: results.filter((result) => result.ok && result.status === "issued").length,
    queued: results.filter((result) => result.ok && result.status === "queued").length,
    failed: results.filter((result) => !result.ok && result.status === "error").length,
    skipped: results.filter((result) => !result.ok && result.status === "skipped").length,
  };
}
