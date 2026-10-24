import { searchTokens } from "@/lib/normalize";

export type PosSearchUnitLike = {
  unitName: string;
  directSale?: boolean;
  sku?: string | null;
  barcode?: string | null;
};

export type PosSearchProductLike = {
  baseUnit: string;
  baseUnitDirectSale?: boolean;
  isVariantParent: boolean;
  sku?: string | null;
  barcode?: string | null;
  units: readonly PosSearchUnitLike[];
};

export type PosSearchUnitResult<TProduct extends PosSearchProductLike> = {
  product: TProduct;
  unitName: string | null;
  alternateUnit: TProduct["units"][number] | null;
};

/** Rank expanded product/unit rows the same way across product pickers. */
export function rankProductSearchUnitResults<TProduct extends PosSearchProductLike>(
  results: readonly PosSearchUnitResult<TProduct>[],
  query: string,
  productLabel: (product: TProduct) => string,
  { sellableOnly = false }: { sellableOnly?: boolean } = {},
): PosSearchUnitResult<TProduct>[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [...results];

  const queryKey = tokens.join(" ");
  const ranked = results.map((result, index) => {
    const label = productLabel(result.product);
    const productTokens = new Set(searchTokens(label));
    const unitTokens = new Set(searchTokens(result.unitName ?? ""));
    const visibleTokens = new Set([...productTokens, ...unitTokens]);
    const units = result.product.units.filter((unit) => !sellableOnly || unit.directSale === true);
    const includeBaseMetadata = !sellableOnly || (!result.product.isVariantParent && result.product.baseUnitDirectSale === true);
    const metadataTokens = new Set(searchTokens([
      result.product.sku,
      ...(includeBaseMetadata ? [result.product.barcode, result.product.baseUnit] : []),
      ...units.flatMap((unit) => [unit.unitName, unit.sku, unit.barcode]),
    ].filter(Boolean).join(" ")));
    const countMatches = (candidates: ReadonlySet<string>) =>
      tokens.filter((token) => [...candidates].some((candidate) => candidate.includes(token))).length;
    const rowLabel = searchTokens(`${label} ${result.unitName ?? ""}`).join(" ");

    return {
      result,
      index,
      rank: [
        Number(rowLabel === queryKey),
        countMatches(visibleTokens),
        countMatches(productTokens),
        countMatches(unitTokens),
        countMatches(metadataTokens),
      ],
    };
  });

  ranked.sort((left, right) => {
    for (let index = 0; index < left.rank.length; index += 1) {
      const difference = right.rank[index] - left.rank[index];
      if (difference !== 0) return difference;
    }
    return left.index - right.index;
  });
  return ranked
    .filter(({ rank }) => !sellableOnly || rank.some((value) => value > 0))
    .map(({ result }) => result);
}

/** Every configured unit, used by operational pickers where non-sale units are valid. */
export function expandProductSearchUnitResults<TProduct extends PosSearchProductLike>(
  products: readonly TProduct[],
): PosSearchUnitResult<TProduct>[] {
  return expandUnitResults(products, () => true, () => true);
}

/**
 * Sellable products appear once per selling unit in POS search. Variant parents
 * remain a single row because the cashier must choose a child SKU first.
 */
export function expandPosSearchUnitResults<TProduct extends PosSearchProductLike>(
  products: readonly TProduct[],
): PosSearchUnitResult<TProduct>[] {
  return expandUnitResults(
    products,
    (product) => product.baseUnitDirectSale !== false,
    (unit) => unit.directSale !== false,
  );
}

function expandUnitResults<TProduct extends PosSearchProductLike>(
  products: readonly TProduct[],
  includeBase: (product: TProduct) => boolean,
  includeUnit: (unit: TProduct["units"][number]) => boolean,
): PosSearchUnitResult<TProduct>[] {
  return products.flatMap((product) => {
    if (product.isVariantParent) {
      return [{ product, unitName: null, alternateUnit: null }];
    }

    const seen = new Set<string>();
    const results: PosSearchUnitResult<TProduct>[] = [];
    const baseUnit = product.baseUnit.trim();
    if (baseUnit && includeBase(product)) {
      seen.add(baseUnit);
      results.push({ product, unitName: product.baseUnit, alternateUnit: null });
    }

    for (const unit of product.units) {
      const unitName = unit.unitName.trim();
      if (!unitName || !includeUnit(unit) || seen.has(unitName)) continue;
      seen.add(unitName);
      results.push({ product, unitName: unit.unitName, alternateUnit: unit });
    }
    return results;
  });
}
