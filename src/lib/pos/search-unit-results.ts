export type PosSearchUnitLike = {
  unitName: string;
};

export type PosSearchProductLike = {
  baseUnit: string;
  isVariantParent: boolean;
  units: readonly PosSearchUnitLike[];
};

export type PosSearchUnitResult<TProduct extends PosSearchProductLike> = {
  product: TProduct;
  unitName: string | null;
  alternateUnit: TProduct["units"][number] | null;
};

/**
 * Sellable products appear once per selling unit in POS search. Variant parents
 * remain a single row because the cashier must choose a child SKU first.
 */
export function expandPosSearchUnitResults<TProduct extends PosSearchProductLike>(
  products: readonly TProduct[],
): PosSearchUnitResult<TProduct>[] {
  return products.flatMap((product) => {
    if (product.isVariantParent) {
      return [{ product, unitName: null, alternateUnit: null }];
    }

    const seen = new Set<string>();
    const results: PosSearchUnitResult<TProduct>[] = [];
    const baseUnit = product.baseUnit.trim();
    seen.add(baseUnit);
    results.push({ product, unitName: product.baseUnit, alternateUnit: null });

    for (const unit of product.units) {
      const unitName = unit.unitName.trim();
      if (!unitName || seen.has(unitName)) continue;
      seen.add(unitName);
      results.push({ product, unitName: unit.unitName, alternateUnit: unit });
    }
    return results;
  });
}
