import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  einvoices,
  orderItems,
  orders,
  products,
  storeSettings,
} from "@/db/schema";
import {
  executeEInvoiceAttempt,
  resolveEInvoiceProviderAdapter,
  selectEInvoiceIssuanceProvider,
  type EInvoiceProviderAdapter,
  type EInvoiceProviderRequest,
} from "@/lib/einvoice/provider";

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

  try {
    const [order, settings, lines] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, claimed.orderId)).limit(1),
      db.select().from(storeSettings).where(eq(storeSettings.id, "default")).limit(1),
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
        .where(eq(orderItems.orderId, claimed.orderId)),
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
    await db
      .update(einvoices)
      .set({
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
      })
      .where(and(eq(einvoices.id, claimed.id), eq(einvoices.lockToken, lockToken)));

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
    await db
      .update(einvoices)
      .set({
        status: "error",
        attemptCount: claimed.attemptCount + 1,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastError: message,
        lockedAt: null,
        lockToken: null,
        updatedAt: new Date(),
      })
      .where(and(eq(einvoices.id, claimed.id), eq(einvoices.lockToken, lockToken)));
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
      or(isNull(einvoices.lockedAt), lt(einvoices.lockedAt, staleLock)),
    ));

  const due = await db
    .select({ id: einvoices.id })
    .from(einvoices)
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
