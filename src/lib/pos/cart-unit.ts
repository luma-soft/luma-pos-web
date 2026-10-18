export type PosCartUnitLike = {
  unitName: string;
  multiplier: string | number;
  directSale?: boolean;
};

export function isPosUnitSellable<TUnit extends PosCartUnitLike>(
  baseUnit: string,
  baseUnitDirectSale: boolean,
  alternateUnits: readonly TUnit[],
  selectedUnitName: string,
) {
  if (selectedUnitName === baseUnit) return baseUnitDirectSale;
  return alternateUnits.some((unit) => unit.unitName === selectedUnitName && unit.directSale !== false);
}

export function defaultPosSellableUnitName<TUnit extends PosCartUnitLike>(
  baseUnit: string,
  baseUnitDirectSale: boolean,
  alternateUnits: readonly TUnit[],
) {
  if (baseUnitDirectSale) return baseUnit;
  return alternateUnits.find((unit) => unit.directSale !== false)?.unitName ?? null;
}

export function resolvePosCartUnit<TUnit extends PosCartUnitLike>(
  baseUnit: string,
  alternateUnits: readonly TUnit[],
  selectedUnitName = baseUnit,
) {
  const requestedUnitName = selectedUnitName.trim();
  if (!requestedUnitName || requestedUnitName === baseUnit) {
    return {
      unitName: baseUnit,
      unitMultiplier: 1,
      alternateUnit: null,
    };
  }

  const alternateUnit = alternateUnits.find(
    (unit) => unit.unitName === requestedUnitName,
  );
  if (!alternateUnit) {
    return {
      unitName: baseUnit,
      unitMultiplier: 1,
      alternateUnit: null,
    };
  }

  const parsedMultiplier = Number(alternateUnit.multiplier);
  return {
    unitName: alternateUnit.unitName,
    unitMultiplier:
      Number.isFinite(parsedMultiplier) && parsedMultiplier > 0
        ? parsedMultiplier
        : 1,
    alternateUnit,
  };
}
