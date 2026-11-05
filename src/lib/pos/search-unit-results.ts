import { normalizeSearch, searchTokens } from "@/lib/normalize";

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

export type PosSearchRankFacts = {
  label: string;
  labelKey: string;
  productTokens: ReadonlySet<string>;
  metadataTokens: ReadonlySet<string>;
  unitFactsByName: Map<string, PosSearchUnitRankFacts>;
};

type PosSearchUnitRankFacts = {
  rowLabelKey: string;
  tokens: ReadonlySet<string>;
  visibleTokens: ReadonlySet<string>;
};

export type PosSearchRankFactsCache<TProduct extends PosSearchProductLike> =
  WeakMap<TProduct, WeakMap<(product: TProduct) => string, Map<boolean, PosSearchRankFacts>>>;

function normalizedSearchKey(value: string): string {
  const normalized = normalizeSearch(value)
    .replace(/(^|\D)(\d{2})\s*[*x×]\s*(\d{2})(?=\D|$)/gu, "$1$2 $3")
    .replace(/(^|\D)(\d{2})(\d{2})(?=\D|$)/gu, "$1$2 $3");
  return searchTokens(normalized).join(" ");
}

function countMatches(tokens: readonly string[], candidates: ReadonlySet<string>): number {
  let count = 0;
  for (const token of tokens) {
    for (const candidate of candidates) {
      if (!candidate.includes(token)) continue;
      count += 1;
      break;
    }
  }
  return count;
}

/** Rank expanded product/unit rows the same way across product pickers. */
export function rankProductSearchUnitResults<TProduct extends PosSearchProductLike>(
  results: readonly PosSearchUnitResult<TProduct>[],
  query: string,
  productLabel: (product: TProduct) => string,
  {
    sellableOnly = false,
    factsCache,
  }: {
    sellableOnly?: boolean;
    factsCache?: PosSearchRankFactsCache<TProduct>;
  } = {},
): PosSearchUnitResult<TProduct>[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [...results];

  const queryKey = normalizedSearchKey(query);
  const productFacts = new Map<TProduct, PosSearchRankFacts>();
  const ranked = results.map((result, index) => {
    let facts = productFacts.get(result.product);
    if (!facts) {
      facts = factsCache?.get(result.product)?.get(productLabel)?.get(sellableOnly);
      if (!facts) {
        const label = productLabel(result.product);
        const productTokens = new Set(searchTokens(label));
        const units = result.product.units.filter((unit) => !sellableOnly || unit.directSale === true);
        const includeBaseMetadata = !sellableOnly || (!result.product.isVariantParent && result.product.baseUnitDirectSale === true);
        const metadataTokens = new Set(searchTokens([
          result.product.sku,
          ...(includeBaseMetadata ? [result.product.barcode, result.product.baseUnit] : []),
          ...units.flatMap((unit) => [unit.unitName, unit.sku, unit.barcode]),
        ].filter(Boolean).join(" ")));
        facts = {
          label,
          labelKey: normalizedSearchKey(label),
          productTokens,
          metadataTokens,
          unitFactsByName: new Map(),
        };

        if (factsCache) {
          const labelCache = factsCache.get(result.product) ?? new WeakMap<(product: TProduct) => string, Map<boolean, PosSearchRankFacts>>();
          const modes = labelCache.get(productLabel) ?? new Map<boolean, PosSearchRankFacts>();
          modes.set(sellableOnly, facts);
          labelCache.set(productLabel, modes);
          factsCache.set(result.product, labelCache);
        }
      }
      productFacts.set(result.product, facts);
    }

    const unitName = result.unitName ?? "";
    let unitFacts = facts.unitFactsByName.get(unitName);
    if (!unitFacts) {
      const unitTokens = new Set(searchTokens(unitName));
      unitFacts = {
        rowLabelKey: normalizedSearchKey(unitName ? `${facts.label} ${unitName}` : facts.label),
        tokens: unitTokens,
        visibleTokens: new Set([...facts.productTokens, ...unitTokens]),
      };
      facts.unitFactsByName.set(unitName, unitFacts);
    }

    return {
      result,
      index,
      labelExact: Number(facts.labelKey === queryKey),
      rowExact: Number(unitFacts.rowLabelKey === queryKey),
      visibleMatches: countMatches(tokens, unitFacts.visibleTokens),
      productMatches: countMatches(tokens, facts.productTokens),
      unitMatches: countMatches(tokens, unitFacts.tokens),
      metadataMatches: countMatches(tokens, facts.metadataTokens),
    };
  });

  ranked.sort((left, right) => {
    return right.labelExact - left.labelExact
      || right.rowExact - left.rowExact
      || right.visibleMatches - left.visibleMatches
      || right.productMatches - left.productMatches
      || right.unitMatches - left.unitMatches
      || right.metadataMatches - left.metadataMatches
      || left.index - right.index;
  });
  return ranked
    .filter(({ labelExact, rowExact, visibleMatches, productMatches, unitMatches, metadataMatches }) => (
      !sellableOnly
      || labelExact > 0
      || rowExact > 0
      || visibleMatches > 0
      || productMatches > 0
      || unitMatches > 0
      || metadataMatches > 0
    ))
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
