import { normalizeSearch, matchesSearchTokens } from "@/lib/normalize";
import { formatCurrency } from "@/lib/utils";

type VariantSummary = {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  baseUnit?: string | null;
  unitNames?: string | null;
  unitDefinitions?: Array<{
    unitName?: string | null;
    sku?: string | null;
    barcode?: string | null;
  }>;
  variantName?: string | null;
  specs?: unknown;
};

export function productVariantValues(product: Pick<VariantSummary, "variantName" | "specs">) {
  const values: string[] = [];
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const variantParts = new Set((product.variantName ?? "")
    .split(/\s*\/\s*/)
    .map(normalize)
    .filter(Boolean));
  const add = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text || values.some((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase())) return;
    values.push(text);
  };
  add(product.variantName);
  if (product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)) {
    for (const [key, raw] of Object.entries(product.specs as Record<string, unknown>)) {
      if (key.startsWith("__")) continue;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (variantParts.has(normalize(String(value ?? "")))) continue;
        add(value);
      }
    }
  }
  return values;
}

export function productDisplayName(product: Pick<VariantSummary, "name" | "variantName" | "specs">, separator = " · ") {
  const name = product.name.trim();
  const lower = name.toLocaleLowerCase();
  return [name, ...productVariantValues(product).filter((value) => !lower.includes(value.toLocaleLowerCase()))].join(separator);
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
    product.baseUnit,
    product.unitNames,
    ...(product.unitDefinitions ?? []).flatMap((unit) => [unit.unitName, unit.sku, unit.barcode]),
    ...(options.includeProductName === false ? [] : [product.name]),
    productVariantLabel(product),
    ...(options.includeProductName === false
      ? []
      : Object.keys(product.specs ?? {}).filter((name) => !name.startsWith("__"))),
  ].join(" "));
  return matchesSearchTokens(text, search);
}

/** Inventory search keeps all query terms inside the product name, SKU, or barcode field. */
export function matchesInventoryProductSearch(product: VariantSummary, query: string) {
  if (!normalizeSearch(query)) return true;

  const specificationFields: string[] = [];
  if (product.specs && typeof product.specs === "object" && !Array.isArray(product.specs)) {
    for (const [name, raw] of Object.entries(product.specs as Record<string, unknown>)) {
      if (name.startsWith("__")) continue;
      specificationFields.push(name);
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value !== null && value !== undefined) specificationFields.push(String(value));
      }
    }
  }

  const productName = [product.name, ...productVariantValues(product), ...specificationFields]
    .filter(Boolean)
    .join(" ");
  const searchableFields = [
    productName,
    product.sku,
    product.barcode ?? "",
    product.baseUnit ?? "",
    product.unitNames ?? "",
    ...(product.unitDefinitions ?? []).flatMap((unit) => [unit.unitName ?? "", unit.sku ?? "", unit.barcode ?? ""]),
  ];

  return searchableFields.some((field) => matchesSearchTokens(field, query));
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

/** Document snapshots may predate attribute metadata. */
export function productLineDisplayName(product: { productName: string; productVariantName?: string | null; productSpecs?: unknown }) {
  return productDisplayName({ name: product.productName, variantName: product.productVariantName, specs: product.productSpecs });
}

/** Natural order for option values: "2", "10", "32GB", "64GB", "512GB". */
export function compareVariantValues(left: string, right: string) {
  return left.localeCompare(right, "vi", { numeric: true, sensitivity: "base" });
}

type SortableVariant = { id: string; sku?: string; name?: string; variantName?: string | null; specs?: unknown };

/** Members follow their option values, not SKU codes (SP002275-188256…). */
export function sortVariantMembers<T extends SortableVariant>(members: readonly T[]): T[] {
  const label = (member: T) => productVariantValues(member).join(" · ") || member.name || "";
  return [...members].sort((left, right) => compareVariantValues(label(left), label(right))
    || (left.sku ?? "").localeCompare(right.sku ?? "", "vi") || left.id.localeCompare(right.id));
}

/**
 * Group price range for list summaries. SKUs without a price (0) are left out so
 * a group does not read "from 0 đ"; a group where no SKU has a price stays 0.
 */
export function variantPriceRange(prices: readonly (number | string | null | undefined)[]) {
  const values = prices.map(Number).filter((value) => Number.isFinite(value));
  const priced = values.filter((value) => value > 0);
  const source = priced.length ? priced : values;
  if (!source.length) return { min: 0, max: 0 };
  return { min: Math.min(...source), max: Math.max(...source) };
}

export type VariantOptionSummary = { name: string | null; values: string[] };

/** Attribute values present in a group, per attribute, in natural order. */
export function variantOptionSummary(members: readonly Pick<VariantSummary, "variantName" | "specs">[]): VariantOptionSummary[] {
  const axes = new Map<string, VariantOptionSummary>();
  const unlabeled: string[] = [];
  const add = (target: string[], value: unknown) => {
    const text = String(value ?? "").trim();
    if (text && !target.some((item) => item.toLocaleLowerCase("vi") === text.toLocaleLowerCase("vi"))) target.push(text);
  };
  for (const member of members) {
    const specs = member.specs && typeof member.specs === "object" && !Array.isArray(member.specs)
      ? Object.entries(member.specs as Record<string, unknown>).filter(([name]) => !name.startsWith("__"))
      : [];
    if (!specs.length) { add(unlabeled, member.variantName); continue; }
    for (const [name, raw] of specs) {
      const key = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
      const axis = axes.get(key) ?? { name: name.trim(), values: [] };
      for (const value of Array.isArray(raw) ? raw : [raw]) add(axis.values, value);
      axes.set(key, axis);
    }
  }
  const result = [...axes.values()].filter((axis) => axis.values.length > 0);
  if (unlabeled.length) result.push({ name: null, values: unlabeled });
  return result.map((axis) => ({ ...axis, values: axis.values.sort(compareVariantValues) }));
}

/** "SIZE: 21 · 27 · 34 +5" — short enough for a list row. */
export function formatVariantOptionSummary(summary: readonly VariantOptionSummary[], maxValues = 4, options: { compact?: boolean } = {}) {
  // Phones drop the attribute name of a single-attribute group to keep the values visible.
  const showNames = !options.compact || summary.length > 1;
  return summary.map((axis) => {
    const shown = axis.values.slice(0, maxValues).join(" · ");
    const more = axis.values.length > maxValues ? ` +${axis.values.length - maxValues}` : "";
    return `${showNames && axis.name ? `${axis.name}: ` : ""}${shown}${more}`;
  }).join(" | ");
}

/** "135.000 – 280.000 ₫", or a single price when every SKU costs the same. */
export function formatVariantPriceRange(min: number | string, max: number | string) {
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(high) || low === high) return formatCurrency(low);
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(low)} – ${formatCurrency(high)}`;
}
