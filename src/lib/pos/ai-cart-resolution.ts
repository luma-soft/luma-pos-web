import { normalizeSearch } from "@/lib/normalize";
import { positiveQuantityOrDefault } from "@/lib/quantity";

export type PosAiCartDraftItem = {
  productId?: string;
  productName?: string;
  sku?: string;
  text?: string;
  unitName?: string;
  quantity?: number;
  confidence?: number;
  reason?: string;
};

export type PosAiUnresolvedItem = {
  key: string;
  label: string;
  sku?: string;
  quantity: number;
  reason: string;
};

type AiCartProduct = {
  id: string;
  sku?: string | null;
  name: string;
  isVariantParent?: boolean;
  children?: unknown[];
};

function pendingAiCartItem(raw: unknown, index: number): PosAiUnresolvedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as PosAiCartDraftItem;
  const label = (item.productName ?? item.text ?? item.sku ?? `Dòng ${index + 1}`).trim();
  if (!label) return null;
  return {
    key: `ai-unresolved-${index}-${item.sku ?? label}`,
    label,
    sku: item.sku?.trim() || undefined,
    quantity: positiveQuantityOrDefault(item.quantity),
    reason: item.reason === "inactive_or_not_found"
      ? "Sản phẩm không active hoặc không có trong danh mục"
      : "Không tìm thấy sản phẩm active trong danh mục",
  };
}

function flattenProductTree<T extends AiCartProduct>(products: T[]) {
  return products.flatMap((product) => [
    product,
    ...((product.children ?? []) as T[]),
  ]);
}

export function matchAiCartDraftItems<T extends AiCartProduct>(
  rawItems: unknown[],
  products: T[],
) {
  const matched: Array<{ product: T; quantity: number }> = [];
  const unresolved: PosAiUnresolvedItem[] = [];
  const unmatchedRaw: Array<{ raw: PosAiCartDraftItem; index: number }> = [];

  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as PosAiCartDraftItem;
    const name = normalizeSearch(item.productName ?? "");
    const sku = normalizeSearch(item.sku ?? "");
    const product = products.find((candidate) =>
      !candidate.isVariantParent && (
        (!!item.productId && candidate.id === item.productId)
        || (!!sku && normalizeSearch(candidate.sku ?? "") === sku)
        || (!!name && normalizeSearch(candidate.name) === name)
      ));
    if (!product) {
      const pending = pendingAiCartItem(raw, index);
      if (pending) unresolved.push(pending);
      unmatchedRaw.push({ raw: item, index });
      return;
    }
    matched.push({ product, quantity: positiveQuantityOrDefault(item.quantity) });
  });

  return { matched, unresolved, unmatchedRaw };
}

/** Resolve server-matched AI rows that are outside the POS page's initial 200 products. */
export async function resolveAiCartDraftItems<T extends AiCartProduct>(
  rawItems: unknown[],
  initialProducts: T[],
  searchProducts: (query: string) => Promise<T[]>,
) {
  const initial = matchAiCartDraftItems(rawItems, initialProducts);
  if (initial.unmatchedRaw.length === 0) {
    return { matched: initial.matched, unresolved: initial.unresolved };
  }

  const queries = [...new Set(initial.unmatchedRaw
    .map(({ raw }) => raw.sku?.trim() || raw.productName?.trim() || raw.text?.trim() || "")
    .filter(Boolean))];
  const fetchedGroups = await Promise.all(queries.map(async (query) => {
    try {
      return await searchProducts(query);
    } catch {
      return [];
    }
  }));
  const byId = new Map(initialProducts.map((product) => [product.id, product]));
  for (const product of flattenProductTree(fetchedGroups.flat())) {
    byId.set(product.id, product);
  }
  const resolved = matchAiCartDraftItems(rawItems, [...byId.values()]);
  return { matched: resolved.matched, unresolved: resolved.unresolved };
}
