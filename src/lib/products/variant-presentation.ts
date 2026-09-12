import { normalizeSearch, matchesSearchTokens } from "@/lib/normalize";

type VariantSummary = {
  id: string;
  name: string;
  sku: string;
  variantName?: string | null;
  specs?: unknown;
};

export function productVariantValues(product: Pick<VariantSummary, "variantName" | "specs">) {
  const values: string[] = [];
  const add = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text || values.some((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase())) return;
    values.push(text);
  };
  add(product.variantName);
  if (product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)) {
    for (const [key, raw] of Object.entries(product.specs as Record<string, unknown>)) {
      if (key.startsWith("__")) continue;
      for (const value of Array.isArray(raw) ? raw : [raw]) add(value);
    }
  }
  return values;
}

export function productDisplayName(product: Pick<VariantSummary, "name" | "variantName" | "specs">) {
  const name = product.name.trim();
  const lower = name.toLocaleLowerCase();
  return [name, ...productVariantValues(product).filter((value) => !lower.includes(value.toLocaleLowerCase()))].join(" · ");
}

/** Labels are presentation only. SKU identity always comes from the product ID. */
export function productVariantLabel(product: VariantSummary) {
  if (product.variantName?.trim()) return product.variantName.trim();
  const values = productVariantValues(product);
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
  return matchesSearchTokens(text, search);
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
