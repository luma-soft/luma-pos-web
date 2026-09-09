import type { AiAttachmentCandidate } from "@/lib/ai/provider";
import {
  matchAiInboundProduct,
  type AiProductCandidate,
} from "@/lib/ai/entity-matching";

export type PosImageProductLine = {
  product: AiProductCandidate;
  quantity: number;
  confidence: number;
};

export type PosImageUnresolvedItem = {
  productName: string;
  text: string;
  sku: string | null;
  quantity: number | null;
  reason: "invalid_quantity" | "ambiguous_product" | "not_found_in_catalog";
  candidates?: Array<{
    productId: string;
    productName: string;
    sku: string;
  }>;
};

export function mergeAlternativeProductLines<
  T extends { product: { id: string }; quantity: number; confidence: number },
>(primary: T[], alternative: T[]) {
  const lines = primary.map((line) => ({ ...line })) as T[];
  for (const line of alternative) {
    const existing = lines.find((candidate) => candidate.product.id === line.product.id);
    if (!existing) {
      lines.push({ ...line });
      continue;
    }
    if (line.confidence > existing.confidence) {
      existing.quantity = line.quantity;
      existing.confidence = line.confidence;
    }
  }
  return lines;
}

function positiveNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function candidateQuantity(row: AiAttachmentCandidate) {
  const stated = positiveNumber(row.quantity);
  if (stated != null) return stated;
  const unitPrice = positiveNumber(row.unitCost) ?? positiveNumber(row.grossUnitCost);
  const lineTotal = positiveNumber(row.lineTotal);
  if (unitPrice == null || lineTotal == null) return null;
  const derived = lineTotal / unitPrice;
  return Number.isFinite(derived) && derived > 0 ? derived : null;
}

function posImageProductText(value: string) {
  return value.replace(/\s*\([^()]{1,12}\)\s*$/, "").trim();
}

export function posImageProductLookupValues(rows: AiAttachmentCandidate[]) {
  return [...new Set(rows
    .map((row) => posImageProductText(row.text))
    .filter(Boolean))];
}

/**
 * Build POS lines from the provider's one-row-per-product response. Do not feed
 * these rows back through the free-text parser: invoice STT, unit prices and
 * totals are all numbers and are not quantity candidates.
 */
export function buildPosImageProductLines(
  rows: AiAttachmentCandidate[],
  products: AiProductCandidate[],
) {
  const lines: PosImageProductLine[] = [];
  const unresolvedItems: PosImageUnresolvedItem[] = [];

  for (const row of rows) {
    const quantity = candidateQuantity(row);
    const match = matchAiInboundProduct({
      text: posImageProductText(row.text),
      sku: row.sku,
      confidence: row.confidence,
    }, products);

    if (!match.product || match.ambiguous.length > 0 || quantity == null) {
      unresolvedItems.push({
        productName: row.text,
        text: row.text,
        sku: row.sku ?? null,
        quantity,
        reason: quantity == null
          ? "invalid_quantity"
          : match.ambiguous.length > 0
            ? "ambiguous_product"
            : "not_found_in_catalog",
        ...(match.ambiguous.length > 0 ? {
          candidates: match.ambiguous.slice(0, 5).map((product) => ({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
          })),
        } : {}),
      });
      continue;
    }

    const existing = lines.find((line) => line.product.id === match.product!.id);
    if (existing) {
      existing.quantity += quantity;
      existing.confidence = Math.max(existing.confidence, match.confidence);
    } else {
      lines.push({
        product: match.product,
        quantity,
        confidence: match.confidence,
      });
    }
  }

  return { lines, unresolvedItems };
}
