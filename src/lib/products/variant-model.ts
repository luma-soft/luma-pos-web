/** Shared browser/server contract. Labels never identify a persisted SKU. */
export const MAX_VARIANT_COMBINATIONS = 200;

/** Existing membership is preserved; an operation may generate at most 200 additions. */
export function variantCombinationBudget(existingMemberCount: number, persistedExcludedCount = 0) {
  return MAX_VARIANT_COMBINATIONS + Math.max(0, existingMemberCount) + Math.max(0, persistedExcludedCount);
}

export type VariantAttribute = {
  attributeId?: string;
  name: string;
  values: string[];
  valueIds?: string[];
  createsVariants?: boolean;
};
export type NormalizedVariantAttribute = VariantAttribute & {
  attributeId: string;
  valueIds: string[];
  createsVariants: true;
};
export type VariantCombination = {
  combinationKey: string;
  optionValueIds: string[];
  variantName: string;
  specs: Record<string, string[]>;
};
export class VariantValidationError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export const variantNameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function normalizeVariantAttributes(attributes: readonly VariantAttribute[]): NormalizedVariantAttribute[] {
  const names = new Set<string>();
  const ids = new Set<string>();
  return attributes.filter((a) => a.createsVariants !== false).map((attribute) => {
    const name = attribute.name.trim().replace(/\s+/g, " ");
    const key = variantNameKey(name);
    const attributeId = attribute.attributeId || `attribute:${key}`;
    if (!name || name.startsWith("__") || names.has(key) || ids.has(attributeId)) {
      throw new VariantValidationError("products.variants.invalidAttributes");
    }
    names.add(key); ids.add(attributeId);
    const values = attribute.values.map((value) => value.trim());
    const valueIds = attribute.valueIds ?? values.map((value) => `${attributeId}:value:${variantNameKey(value)}`);
    if (!values.length || values.some((value) => !value) || new Set(values.map(variantNameKey)).size !== values.length
      || valueIds.length !== values.length || valueIds.some((id) => !id) || new Set(valueIds).size !== valueIds.length) {
      throw new VariantValidationError("products.variants.invalidValues");
    }
    return { attributeId, name, values, valueIds, createsVariants: true };
  });
}

export function variantCombinationKey(selections: readonly (readonly [string, string])[]) {
  return JSON.stringify([...selections].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function buildVariantCombinations(attributes: readonly VariantAttribute[], options: { maxCombinations?: number } = {}): VariantCombination[] {
  const axes = normalizeVariantAttributes(attributes);
  if (!axes.length) return [];
  const limit = options.maxCombinations ?? MAX_VARIANT_COMBINATIONS;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new VariantValidationError("products.variants.tooMany");
  const count = axes.reduce((n, a) => n * a.values.length, 1);
  if (!Number.isSafeInteger(count) || count > limit) throw new VariantValidationError("products.variants.tooMany");
  let rows: { selections: [string, string][]; labels: string[]; specs: Record<string, string[]> }[] = [{ selections: [], labels: [], specs: {} }];
  for (const axis of axes) {
    rows = rows.flatMap((row) => axis.values.map((value, index) => ({
      selections: [...row.selections, [axis.attributeId, axis.valueIds[index]] as [string, string]],
      labels: [...row.labels, value], specs: { ...row.specs, [axis.name]: [value] },
    })));
  }
  return rows.map((row) => {
    const combinationKey = variantCombinationKey(row.selections);
    return { combinationKey, optionValueIds: (JSON.parse(combinationKey) as [string, string][]).map((pair) => pair[1]),
      variantName: row.labels.join(" / "), specs: row.specs };
  });
}

export type VariantSubmittedRow = {
  productId?: string;
  combinationKey?: string;
  optionValueIds?: string[];
  specs: Record<string, string[]>;
  sku?: string;
  initialStock?: number;
};

/** Resolves legacy specs as well as the versioned identity payload, never by label. */
export function validateVariantSubmission<T extends VariantSubmittedRow>(input: {
  attributes: readonly VariantAttribute[];
  children: readonly T[];
  excludedCombinationKeys?: readonly string[];
  allowPartial?: boolean;
  maxCombinations?: number;
}): (T & VariantCombination)[] {
  const combinations = buildVariantCombinations(input.attributes, { maxCombinations: input.maxCombinations });
  const keys = new Map(combinations.map((row) => [row.combinationKey, row]));
  const exclusions = new Set(input.excludedCombinationKeys ?? []);
  if (exclusions.size !== (input.excludedCombinationKeys ?? []).length || [...exclusions].some((key) => !keys.has(key))) {
    throw new VariantValidationError("products.variants.invalidExclusions");
  }
  const selected = new Set<string>();
  const productIds = new Set<string>();
  const skus = new Set<string>();
  const resolved = input.children.map((child) => {
    const matchesSpecs = (combo: VariantCombination) => {
      const visible = Object.entries(child.specs).filter(([key]) => !key.startsWith("__"));
      return visible.length === Object.keys(combo.specs).length && visible.every(([name, values]) =>
        values.length === 1 && Object.entries(combo.specs).some(([expected, selectedValues]) =>
          variantNameKey(expected) === variantNameKey(name) && selectedValues[0] === values[0].trim()));
    };
    const combo = child.combinationKey ? keys.get(child.combinationKey) : combinations.find(matchesSpecs);
    if (!combo || !matchesSpecs(combo) || exclusions.has(combo.combinationKey)
      || selected.has(combo.combinationKey) || (child.optionValueIds && JSON.stringify(child.optionValueIds) !== JSON.stringify(combo.optionValueIds))) {
      throw new VariantValidationError("products.variants.invalidCombination");
    }
    if (child.productId && (productIds.has(child.productId) || Number(child.initialStock ?? 0) !== 0)) {
      throw new VariantValidationError("products.variants.existingStock");
    }
    const sku = child.sku?.trim().toLowerCase();
    if (sku && skus.has(sku)) throw new VariantValidationError("products.errors.skuExists");
    if (sku) skus.add(sku);
    if (child.productId) productIds.add(child.productId);
    selected.add(combo.combinationKey);
    return { ...child, ...combo };
  });
  if (!input.allowPartial && combinations.some((combo) => !selected.has(combo.combinationKey) && !exclusions.has(combo.combinationKey))) {
    throw new VariantValidationError("products.variants.missingCombinations");
  }
  if (combinations.length && !resolved.length && !input.allowPartial) throw new VariantValidationError("products.variants.emptyGroup");
  return resolved;
}

/** Stable key reconciliation preserves commercial fields, including a removed/re-added draft row. */
export function reconcileVariantRows<T extends { combinationKey?: string }>(
  combinations: readonly VariantCombination[], existing: readonly T[], makeNew: (combination: VariantCombination) => T,
): (T & VariantCombination)[] {
  const byKey = new Map(existing.filter((row) => row.combinationKey).map((row) => [row.combinationKey, row]));
  return combinations.map((combo) => ({ ...(byKey.get(combo.combinationKey) ?? makeNew(combo)), ...combo }));
}
