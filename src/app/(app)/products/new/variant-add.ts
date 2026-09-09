import type { CreateProductOutput } from "./schema";
import { buildVariantCombinations, normalizeVariantAttributes, variantNameKey, VariantValidationError } from "@/lib/products/variant-model";

/** Turn the compact "add same type" form into one authoritative new SKU row. */
export function prepareVariantAddition(values: CreateProductOutput): CreateProductOutput {
  if (values.variantOperation !== "add" || !values.variantGroupId) return values;

  const axes = normalizeVariantAttributes(values.attributes);
  const additions = axes.map((axis) => {
    const value = values.variantAddValues[axis.attributeId]?.trim() ?? "";
    if (!value || axis.values.some((existing) => variantNameKey(existing) === variantNameKey(value))) {
      throw new VariantValidationError("products.variants.invalidValues");
    }
    return { value, id: crypto.randomUUID() };
  });
  if (!axes.length) throw new VariantValidationError("products.variants.invalidAttributes");

  const expanded = axes.map((axis, index) => ({
    ...axis,
    values: [...axis.values, additions[index].value],
    valueIds: [...axis.valueIds, additions[index].id],
  }));
  const combinations = buildVariantCombinations(expanded, {
    maxCombinations: combinationsBudget(values),
  });
  const addedIds = new Set(additions.map((addition) => addition.id));
  const added = combinations.find((combination) => combination.optionValueIds.every((id) => addedIds.has(id)));
  if (!added) throw new VariantValidationError("products.variants.invalidCombination");

  const existing = new Set(values.variantExistingCombinationKeys);
  return {
    ...values,
    attributes: expanded,
    variantChildren: [{
      ...added,
      name: values.name.trim(),
      sku: values.sku?.trim() ?? "",
      barcode: values.barcode?.trim() ?? "",
      baseUnit: values.baseUnit,
      costPrice: values.costPrice,
      retailPrice: values.retailPrice,
      wholesalePrice: values.wholesalePrice,
      contractorPrice: values.contractorPrice,
      agentPrice: values.agentPrice,
      initialStock: values.initialStock,
      minLevel: values.minLevel,
      imageUrls: values.imageUrls,
      directSale: values.directSale,
    }],
    excludedCombinationKeys: combinations
      .filter((combination) => combination.combinationKey !== added.combinationKey && !existing.has(combination.combinationKey))
      .map((combination) => combination.combinationKey),
  };
}

function combinationsBudget(values: CreateProductOutput) {
  return Math.max(
    200,
    values.variantExistingCombinationKeys.length + values.excludedCombinationKeys.length + 200,
  );
}
