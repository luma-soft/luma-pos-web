import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, orderItems, orders, posSharedDrafts, priceBooks, products, projects } from "@/db/schema";
import { generateCode, getProfileId, toMoney, toQty } from "@/lib/actions/common";
import { getSharedPosDrafts } from "@/lib/pos/shared-drafts";
import { resolveLinePriceEditor } from "@/lib/pos/line-price-editor";
import { calculateTaxBreakdown } from "@/lib/tax/calculations";

const MAX_PAYLOAD_BYTES = 512_000;
const draftIdSchema = z.string().trim().min(1).max(128);
const payloadSchema = z.record(z.string(), z.unknown()).superRefine((payload, context) => {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    context.addIssue({ code: "custom", message: "Draft payload is too large" });
  }
});

export const posOrderDraftRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), draftId: draftIdSchema, payload: payloadSchema }),
  z.object({ action: z.literal("delete"), draftId: draftIdSchema }),
]);

export type POSOrderDraftRecord = {
  id: string;
  orderId: string;
  code: string;
  payload: Record<string, unknown>;
  updatedAt: string;
  deleted: boolean;
  status: string;
};

type DraftLine = {
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  preDiscountUnitPrice: number;
  unitPrice: number;
  lineDiscount: number;
  lineDiscountMode: "pct" | "vnd";
  lineDiscountValue: number;
  priceBookId: string | null;
  total: number;
  note: string | null;
  vatRate: number | null;
};

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maxLength = 2_000): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function numeric(value: unknown, fallback?: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback ?? Number.NaN;
}

function uuid(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function dateValue(value: unknown): Date | null {
  const candidate = text(value, 64);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function draftError(message: "POS_DRAFT_INVALID" | "POS_DRAFT_FINALIZED") {
  return new Error(message);
}

function draftLines(payload: Record<string, unknown>): DraftLine[] {
  if (!Array.isArray(payload.lines) || payload.lines.length > 500) throw draftError("POS_DRAFT_INVALID");
  return payload.lines.map((rawValue) => {
    const raw = object(rawValue);
    const snapshot = object(raw.productSnapshot);
    const productId = uuid(raw.productId) ?? uuid(snapshot.id);
    const productName = text(snapshot.name) ?? text(raw.productName);
    const unitName = text(raw.unitId, 30) ?? text(snapshot.baseUnit, 30) ?? "";
    const unitMultiplier = numeric(raw.unitMultiplier, 1);
    const quantity = numeric(raw.quantity);
    const basePrice = numeric(raw.manualPrice, numeric(raw.basePrice));
    const preDiscountUnitPrice = basePrice * unitMultiplier;
    const rawDiscountType = text(raw.discountType)?.toLowerCase();
    const lineDiscountMode = rawDiscountType === "%" || rawDiscountType === "pct" || rawDiscountType === "percent"
      ? "pct"
      : "vnd";
    const lineDiscountValue = numeric(raw.discountValue, 0);
    if (!productId || !productName || !unitName || !Number.isFinite(unitMultiplier) || unitMultiplier <= 0
      || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(preDiscountUnitPrice) || preDiscountUnitPrice < 0
      || !Number.isFinite(lineDiscountValue) || lineDiscountValue < 0) {
      throw draftError("POS_DRAFT_INVALID");
    }
    const price = resolveLinePriceEditor({
      price: String(preDiscountUnitPrice),
      discount: String(lineDiscountValue),
      discountMode: lineDiscountMode,
      free: false,
    });
    const unitPrice = Math.max(0, price.sellPrice);
    const lineDiscount = Math.max(0, preDiscountUnitPrice - unitPrice);
    const priceBookId = uuid(raw.priceListOverride) ?? uuid(payload.priceList);
    const vatRate = numeric(snapshot.vatRate, Number.NaN);
    return {
      productId,
      productName,
      unitName,
      unitMultiplier,
      quantity,
      preDiscountUnitPrice,
      unitPrice,
      lineDiscount,
      lineDiscountMode,
      lineDiscountValue,
      priceBookId,
      total: unitPrice * quantity,
      note: text(raw.note) ?? null,
      vatRate: Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 100 ? vatRate : null,
    };
  });
}

function draftDocumentType(payload: Record<string, unknown>): "sale" | "quote" | "booking" {
  const kind = text(payload.webDraftKind) ?? text(object(payload.webMetadata).webDraftKind) ?? text(payload.kind);
  if (kind === "quote" || kind === "quotation") return "quote";
  if (kind === "booking") return "booking";
  return "sale";
}

function draftSummary(payload: Record<string, unknown>, lines: DraftLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const rawDiscount = Math.max(0, numeric(payload.orderDiscountValue, 0));
  const discountType = text(payload.orderDiscountType)?.toLowerCase();
  const discount = discountType === "%" || discountType === "pct" || discountType === "percent"
    ? Math.min(subtotal, subtotal * rawDiscount / 100)
    : Math.min(subtotal, rawDiscount);
  const taxEnabled = payload.vatOn === true || payload.taxEnabled === true;
  const taxRate = taxEnabled ? Math.min(100, Math.max(0, numeric(payload.taxRate, 0))) : 0;
  const tax = calculateTaxBreakdown({
    lines: lines.map((line) => ({ total: line.total, vatRate: taxEnabled ? line.vatRate : 0 })),
    discount,
    fallbackVatRate: taxRate,
    priceIncludesTax: payload.priceIncludesTax === true,
  });
  const shippingFee = Math.max(0, numeric(payload.shippingFee, 0));
  return {
    subtotal,
    discount,
    tax: tax.tax,
    shippingFee,
    total: tax.totalAfterTax + shippingFee,
  };
}

async function validateDraftReferences(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  storeId: string,
  payload: Record<string, unknown>,
  lines: DraftLine[],
) {
  const productIDs = [...new Set(lines.map((line) => line.productId))];
  if (productIDs.length) {
    const found = await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, productIDs)));
    if (found.length !== productIDs.length) throw draftError("POS_DRAFT_INVALID");
  }
  const customerId = uuid(payload.customerServerId) ?? uuid(payload.customerId);
  if (customerId) {
    const [customer] = await tx.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.id, customerId))).limit(1);
    if (!customer) throw draftError("POS_DRAFT_INVALID");
  }
  const projectId = uuid(payload.projectId);
  if (projectId) {
    const [project] = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.storeId, storeId), eq(projects.id, projectId))).limit(1);
    if (!project) throw draftError("POS_DRAFT_INVALID");
  }
  const priceBookIDs = [...new Set(lines.flatMap((line) => line.priceBookId ? [line.priceBookId] : []))];
  if (priceBookIDs.length) {
    const found = await tx.select({ id: priceBooks.id }).from(priceBooks)
      .where(and(eq(priceBooks.storeId, storeId), inArray(priceBooks.id, priceBookIDs)));
    if (found.length !== priceBookIDs.length) throw draftError("POS_DRAFT_INVALID");
  }
  return { customerId, projectId };
}

function toRecord(row: {
  id: string;
  posDraftId: string | null;
  posDraftPayload: Record<string, unknown> | null;
  code: string;
  status: string;
  updatedAt: Date;
}): POSOrderDraftRecord {
  return {
    id: row.posDraftId ?? "",
    orderId: row.id,
    code: row.code,
    payload: row.posDraftPayload ?? {},
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.status !== "draft" || row.posDraftPayload == null,
    status: row.status,
  };
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function savePOSOrderDraft(
  storeId: string,
  ownerUserId: string,
  actorUserId: string,
  draftId: string,
  payloadValue: unknown,
): Promise<POSOrderDraftRecord> {
  const parsedPayload = payloadSchema.safeParse(payloadValue);
  if (!parsedPayload.success || parsedPayload.data.id !== draftId) throw draftError("POS_DRAFT_INVALID");
  const payload = parsedPayload.data;
  const lines = draftLines(payload);
  if (lines.length === 0) throw draftError("POS_DRAFT_INVALID");
  const documentType = draftDocumentType(payload);
  const summary = draftSummary(payload, lines);
  const profileId = await getProfileId(actorUserId);
  if (!profileId) throw draftError("POS_DRAFT_INVALID");

  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pos-draft:${storeId}:${draftId}`}, 0))`);
    const references = await validateDraftReferences(tx, storeId, payload, lines);
    const [current] = await tx.select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      posDraftPayload: orders.posDraftPayload,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.posDraftId, draftId))).limit(1).for("update");
    if (current && (current.status !== "draft" || current.posDraftPayload == null)) {
      throw draftError("POS_DRAFT_FINALIZED");
    }
    if (current && stableJSON(current.posDraftPayload) === stableJSON(payload)) {
      return {
        id: current.id,
        posDraftId: draftId,
        posDraftPayload: current.posDraftPayload,
        code: current.code,
        status: current.status,
        updatedAt: current.updatedAt,
      };
    }

    const now = new Date();
    const orderValues = {
      storeId,
      code: current?.code ?? generateCode("DH"),
      clientId: null,
      posDraftId: draftId,
      posDraftPayload: payload,
      status: "draft" as const,
      documentType,
      paymentStatus: "unpaid" as const,
      shiftId: null,
      customerId: references.customerId,
      warehouseId: null,
      projectId: references.projectId,
      projectName: text(payload.projectName) ?? null,
      deliveryAddress: text(payload.deliveryAddress) ?? null,
      deliveryDate: dateValue(payload.deliveryDate),
      subtotal: toMoney(summary.subtotal),
      discount: toMoney(summary.discount),
      tax: toMoney(summary.tax),
      shippingFee: toMoney(summary.shippingFee),
      total: toMoney(summary.total),
      amountPaid: "0.00",
      sourceOrderId: uuid(payload.sourceOrderId),
      sourceMode: text(payload.sourceMode, 20) ?? null,
      sourceSaleTime: null,
      replacedByOrderId: null,
      note: text(payload.note) ?? null,
      createdBy: profileId,
      updatedAt: now,
    };

    let orderId: string;
    let code: string;
    let createdAt: Date;
    if (current) {
      orderId = current.id;
      code = current.code;
      createdAt = current.createdAt;
      await tx.delete(orderItems).where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, orderId)));
      await tx.update(orders).set({ ...orderValues, createdAt })
        .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId)));
    } else {
      const [inserted] = await tx.insert(orders).values(orderValues).returning({ id: orders.id, code: orders.code, createdAt: orders.createdAt });
      orderId = inserted.id;
      code = inserted.code;
      createdAt = inserted.createdAt;
    }

    if (lines.length) {
      await tx.insert(orderItems).values(lines.map((line) => ({
        storeId,
        orderId,
        productId: line.productId,
        productName: line.productName,
        unitName: line.unitName,
        unitMultiplier: toQty(line.unitMultiplier),
        priceBookId: line.priceBookId,
        priceBookName: null,
        preDiscountUnitPrice: toMoney(line.preDiscountUnitPrice),
        lineDiscountMode: line.lineDiscountMode,
        lineDiscountValue: toMoney(line.lineDiscountValue),
        quantity: toQty(line.quantity),
        unitPrice: toMoney(line.unitPrice),
        discount: toMoney(line.lineDiscount * line.quantity),
        total: toMoney(line.total),
        note: line.note,
      })));
    }

    await tx.update(posSharedDrafts)
      .set({ deletedAt: now, updatedAt: now, updatedBy: profileId })
      .where(and(
        eq(posSharedDrafts.storeId, storeId),
        eq(posSharedDrafts.ownerUserId, ownerUserId),
        eq(posSharedDrafts.draftId, draftId),
        isNull(posSharedDrafts.deletedAt),
      ));
    return {
      id: orderId,
      posDraftId: draftId,
      posDraftPayload: payload,
      code,
      status: "draft",
      updatedAt: now,
    };
  });
  return toRecord(row);
}

export async function deletePOSOrderDraft(
  storeId: string,
  ownerUserId: string,
  actorUserId: string,
  draftId: string,
) {
  const profileId = await getProfileId(actorUserId);
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pos-draft:${storeId}:${draftId}`}, 0))`);
    const [current] = await tx.select({
      id: orders.id,
      posDraftId: orders.posDraftId,
      posDraftPayload: orders.posDraftPayload,
      code: orders.code,
      status: orders.status,
      updatedAt: orders.updatedAt,
    }).from(orders).where(and(eq(orders.storeId, storeId), eq(orders.posDraftId, draftId))).limit(1).for("update");
    if (current?.status === "draft" && current.posDraftPayload != null) {
      await tx.update(orders).set({ status: "cancelled", posDraftPayload: null, updatedAt: now })
        .where(and(eq(orders.storeId, storeId), eq(orders.id, current.id), eq(orders.status, "draft")));
      if (profileId) {
        await tx.update(posSharedDrafts).set({ deletedAt: now, updatedAt: now, updatedBy: profileId })
          .where(and(
            eq(posSharedDrafts.storeId, storeId),
            eq(posSharedDrafts.ownerUserId, ownerUserId),
            eq(posSharedDrafts.draftId, draftId),
            isNull(posSharedDrafts.deletedAt),
          ));
      }
      return { ...current, status: "cancelled", posDraftPayload: null, updatedAt: now };
    }
    return current;
  });
  return row
    ? toRecord(row)
    : { id: draftId, orderId: "", code: "", payload: {}, updatedAt: now.toISOString(), deleted: true, status: "cancelled" };
}

export async function listPOSOrderDrafts(storeId: string, ownerUserId: string, actorUserId: string) {
  const legacyRecords = await getSharedPosDrafts(storeId, ownerUserId);
  for (const record of legacyRecords) {
    if (record.deleted || object(record.payload).state !== "parked") continue;
    const [existing] = await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.storeId, storeId), eq(orders.posDraftId, record.id))).limit(1);
    if (existing) continue;
    try {
      await savePOSOrderDraft(storeId, ownerUserId, actorUserId, record.id, record.payload);
    } catch {
      // Invalid legacy rows stay in the compatibility store and do not block POS loading.
    }
  }

  const rows = await db.select({
    id: orders.id,
    posDraftId: orders.posDraftId,
    posDraftPayload: orders.posDraftPayload,
    code: orders.code,
    status: orders.status,
    updatedAt: orders.updatedAt,
  }).from(orders).where(and(eq(orders.storeId, storeId), isNotNull(orders.posDraftId)))
    .orderBy(asc(orders.updatedAt), asc(orders.posDraftId));
  return rows.map(toRecord);
}
