"use server";

import { getPurchaseProductRowsByIds, searchPurchaseProductRows, type PurchaseProductRow } from "@/lib/data/inventory";
import { resolveAiProductUnit } from "@/lib/ai/entity-matching";
import { requireStockAccess } from "./common";

export type PurchaseDraftProductLookup = {
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  text?: string | null;
  unitName?: string | null;
  unitMultiplier?: number | null;
  quantity?: number | null;
  unitCost?: number | null;
  discount?: number | null;
};

export type PurchaseDraftProductResolution = {
  product: PurchaseProductRow | null;
  seed: {
    productId: string;
    unitName: string;
    multiplier: number;
    quantity: number;
    unitCost: number;
    discount: number;
  };
  pending: {
    key: string;
    label: string;
    sku?: string;
    meta?: string;
  } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function compactSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function productNameQueries(label: string) {
  const raw = compactSpaces(label);
  const cleaned = compactSpaces(label.replace(/\b[A-Z]{1,6}\d[A-Z0-9._-]{2,}\b/gi, "").replace(/[·|,;:]+/g, " "));
  const words = cleaned.split(/\s+/).filter(Boolean);
  return Array.from(new Set([
    raw,
    cleaned,
    words.length >= 3 ? words.slice(0, 3).join(" ") : "",
    words.length >= 2 ? words.slice(0, 2).join(" ") : "",
  ].filter(Boolean)));
}

/** Tìm sản phẩm cho phiếu nhập (server-side, bỏ dấu, quét toàn bộ). */
export async function searchPurchaseProducts(q: string): Promise<PurchaseProductRow[]> {
  if (!q.trim()) return [];
  const gate = await requireStockAccess();
  if (!gate.ok) return [];
  return searchPurchaseProductRows(gate.storeId, q.trim());
}

export async function getPurchaseProductsByIds(ids: string[]): Promise<PurchaseProductRow[]> {
  const safeIds = ids.filter((id) => UUID_RE.test(id));
  if (safeIds.length === 0) return [];
  const gate = await requireStockAccess();
  if (!gate.ok) return [];
  return getPurchaseProductRowsByIds(gate.storeId, safeIds);
}

export async function resolvePurchaseDraftProducts(
  items: PurchaseDraftProductLookup[]
): Promise<PurchaseDraftProductResolution[]> {
  const gate = await requireStockAccess();
  if (!gate.ok || items.length === 0) return [];
  const { storeId } = gate;

  const ids = items
    .map((item) => textValue(item.productId))
    .filter((id) => UUID_RE.test(id));
  const byId = new Map((await getPurchaseProductRowsByIds(storeId, ids)).map((product) => [product.id, product]));

  const resolvedByQuery = new Map<string, PurchaseProductRow | null>();
  async function resolveByQuery(query: string, mode: "sku" | "name") {
    const key = `${mode}:${normalize(query)}`;
    if (resolvedByQuery.has(key)) return resolvedByQuery.get(key) ?? null;
    const rows = await searchPurchaseProductRows(storeId, query);
    const normalized = normalize(query);
    const exact = rows.find((product) =>
      mode === "sku"
        ? normalize(product.sku) === normalized
        : normalize(product.name) === normalized
    );
    const resolved = exact ?? (rows.length === 1 ? rows[0] : null);
    resolvedByQuery.set(key, resolved);
    return resolved;
  }

  async function resolveByName(label: string) {
    for (const query of productNameQueries(label)) {
      const product = await resolveByQuery(query, "name");
      if (product) return product;
    }
    return null;
  }

  const out: PurchaseDraftProductResolution[] = [];
  for (const [index, item] of items.entries()) {
    const productId = textValue(item.productId);
    const sku = textValue(item.sku);
    const label = textValue(item.productName) || textValue(item.text) || sku || `Dòng ${index + 1}`;
    const product =
      (UUID_RE.test(productId) ? byId.get(productId) ?? null : null) ??
      (sku ? await resolveByQuery(sku, "sku") : null) ??
      (label ? await resolveByName(label) : null);
    const sourceUnitName = textValue(item.unitName);
    const resolvedUnit = resolveAiProductUnit(product, sourceUnitName);
    const seedProductId = product?.id ?? productId;
    const unitName = resolvedUnit.unitName || sourceUnitName;
    const multiplier = resolvedUnit.unitName ? resolvedUnit.multiplier : Math.max(1, Number(item.unitMultiplier) || 1);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitCost = Math.max(0, Number(item.unitCost) || 0);
    const discount = Math.max(0, Number(item.discount) || 0);
    out.push({
      product,
      seed: { productId: seedProductId, unitName, multiplier, quantity, unitCost, discount },
      pending: product
        ? null
        : {
            key: `draft-${index}`,
            label,
            sku: sku || undefined,
            meta: [sku, label, sourceUnitName, item.unitCost != null ? `Giá ${item.unitCost}` : ""].filter(Boolean).join(" · "),
          },
    });
  }
  return out;
}
