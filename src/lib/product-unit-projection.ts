export type ProductListUnit = {
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
};

export type ProductUnitProjectionInput = {
  baseUnit: string;
  costPrice: number | string;
  retailPrice: number | string;
  totalStock: number | string;
  reservedStock: number | string;
  minLevel: number | string;
  unitDefinitions: readonly ProductListUnit[];
  selectedUnitName?: string;
};

export type ProductUnitProjection = {
  unitName: string;
  multiplier: number;
  costPrice: number;
  retailPrice: number;
  totalStock: number;
  reservedStock: number;
  minLevel: number;
  hasAlternateUnits: boolean;
};

function finiteNumber(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectProductUnit(
  input: ProductUnitProjectionInput,
): ProductUnitProjection {
  const selected = input.unitDefinitions.find(
    (unit) => unit.unitName === input.selectedUnitName,
  );
  const rawMultiplier = selected ? finiteNumber(selected.multiplier) : 1;
  const multiplier = rawMultiplier > 0 ? rawMultiplier : 1;
  const override = selected?.priceOverride;
  const hasValidOverride =
    override !== null
    && override !== undefined
    && Number.isFinite(Number(override));

  return {
    unitName: selected?.unitName ?? input.baseUnit,
    multiplier,
    costPrice: finiteNumber(input.costPrice) * multiplier,
    retailPrice: hasValidOverride
      ? Number(override)
      : finiteNumber(input.retailPrice) * multiplier,
    totalStock: finiteNumber(input.totalStock) / multiplier,
    reservedStock: finiteNumber(input.reservedStock) / multiplier,
    minLevel: finiteNumber(input.minLevel) / multiplier,
    hasAlternateUnits: input.unitDefinitions.length > 0,
  };
}
