import { normalizeSearch } from "@/lib/normalize";

type VariantSummary = {
  id: string;
  name: string;
  sku: string;
  variantName?: string | null;
  specs?: unknown;
};

/** Labels are presentation only. SKU identity always comes from the product ID. */
export function productVariantLabel(product: VariantSummary) {
  if (product.variantName?.trim()) return product.variantName.trim();
  const values = Object.entries(product.specs ?? {})
    .filter(([name]) => !name.startsWith("__"))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return values.length > 0 ? values.join(" · ") : product.name;
}

export function matchesProductVariant(product: VariantSummary, query: string, options: { includeProductName?: boolean } = {}) {
  const search = normalizeSearch(query);
  if (!search) return true;
  const text = normalizeSearch([
    product.sku,
    ...(options.includeProductName === false ? [] : [product.name]),
    productVariantLabel(product),
    ...(options.includeProductName === false
      ? []
      : Object.keys(product.specs ?? {}).filter((name) => !name.startsWith("__"))),
  ].join(" "));
  return search.split(/\s+/).every((part) => text.includes(part));
}

export function selectableProductIds(product: {
  id: string;
  isVariantParent?: boolean;
  variantGroup?: { members: Array<{ id: string; isVariantParent?: boolean }> } | null;
}, grouped = true) {
  if (grouped && product.variantGroup) {
    return [...new Set(product.variantGroup.members
      .filter((member) => !member.isVariantParent)
      .map((member) => member.id))];
  }
  return product.isVariantParent ? [] : [product.id];
}
