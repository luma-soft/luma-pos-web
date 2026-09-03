import { reconcileVariantRows, variantCombinationBudget, type VariantCombination } from "@/lib/products/variant-model";
import type { CreateProductInput } from "./schema";

type Child = NonNullable<CreateProductInput["variantChildren"]>[number];

/** Capture once at form open. Draft exclusions cannot increase the creation limit. */
export function initialVariantCombinationBudget(values: Partial<CreateProductInput>): number | undefined {
  if (!values.variantGroupId) return undefined;
  return variantCombinationBudget(
    values.variantChildren?.filter((child) => child.productId).length ?? 0,
    values.excludedCombinationKeys?.length ?? 0,
  );
}

/** An existing row owns its commercial values, including an explicit null price. */
export function reconcileVariantChildDrafts(
  combinations: readonly VariantCombination[],
  existing: readonly Child[],
  defaults: Partial<CreateProductInput>,
): Child[] {
  return reconcileVariantRows<Child>(combinations, existing, (row) => ({
    ...row,
    sku: "",
    barcode: "",
    baseUnit: defaults.baseUnit ?? "cái",
    costPrice: defaults.costPrice ?? 0,
    retailPrice: defaults.retailPrice ?? 0,
    wholesalePrice: defaults.wholesalePrice ?? null,
    contractorPrice: defaults.contractorPrice ?? null,
    agentPrice: defaults.agentPrice ?? null,
    initialStock: 0,
    minLevel: defaults.minLevel ?? 0,
    imageUrls: defaults.imageUrls ?? [],
    directSale: defaults.directSale ?? true,
  }));
}
