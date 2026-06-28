"use server";

import { getPurchaseProductRowsByIds, searchPurchaseProductRows, type PurchaseProductRow } from "@/lib/data/inventory";
import { createClient } from "@/lib/supabase/server";

export type PurchaseDraftProductLookup = {
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  text?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  discount?: number | null;
};

export type PurchaseDraftProductResolution = {
  product: PurchaseProductRow | null;
  seed: {
    productId: string;
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

/** Tìm sản phẩm cho phiếu nhập (server-side, bỏ dấu, quét toàn bộ). */
export async function searchPurchaseProducts(q: string): Promise<PurchaseProductRow[]> {
  if (!q.trim()) return [];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return searchPurchaseProductRows(q.trim());
}

export async function getPurchaseProductsByIds(ids: string[]): Promise<PurchaseProductRow[]> {
  const safeIds = ids.filter((id) => UUID_RE.test(id));
  if (safeIds.length === 0) return [];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return getPurchaseProductRowsByIds(safeIds);
}

export async function resolvePurchaseDraftProducts(
  items: PurchaseDraftProductLookup[]
): Promise<PurchaseDraftProductResolution[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || items.length === 0) return [];

  const ids = items
    .map((item) => textValue(item.productId))
    .filter((id) => UUID_RE.test(id));
  const byId = new Map((await getPurchaseProductRowsByIds(ids)).map((product) => [product.id, product]));

  const resolvedByQuery = new Map<string, PurchaseProductRow | null>();
  async function resolveByQuery(query: string, mode: "sku" | "name") {
    const key = `${mode}:${normalize(query)}`;
    if (resolvedByQuery.has(key)) return resolvedByQuery.get(key) ?? null;
    const rows = await searchPurchaseProductRows(query);
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

  const out: PurchaseDraftProductResolution[] = [];
  for (const [index, item] of items.entries()) {
    const productId = textValue(item.productId);
    const sku = textValue(item.sku);
    const label = textValue(item.productName) || textValue(item.text) || sku || `Dòng ${index + 1}`;
    const product =
      (UUID_RE.test(productId) ? byId.get(productId) ?? null : null) ??
      (sku ? await resolveByQuery(sku, "sku") : null) ??
      (label ? await resolveByQuery(label, "name") : null);
    const seedProductId = product?.id ?? productId;
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitCost = Math.max(0, Number(item.unitCost) || 0);
    const discount = Math.max(0, Number(item.discount) || 0);
    out.push({
      product,
      seed: { productId: seedProductId, quantity, unitCost, discount },
      pending: product
        ? null
        : {
            key: `draft-${index}`,
            label,
            sku: sku || undefined,
            meta: [sku, label, item.unitCost != null ? `Giá ${item.unitCost}` : ""].filter(Boolean).join(" · "),
          },
    });
  }
  return out;
}
