export type ProductPhysicalMetadataInput = {
  weight?: number | null;
  weightUnit?: "g" | "kg";
  width?: number | null;
  length?: number | null;
  thickness?: number | null;
  dimUnit?: "mm" | "cm" | "m";
};

export type ProductPhysicalMetadataPatch = {
  weight?: string | null;
  dimensions?: string | null;
  m2PerUnit?: string | null;
};

export function normalizeProductWeightKg(
  weight: number | null | undefined,
  unit: "g" | "kg" = "kg",
): number | null {
  if (weight == null) return null;
  return unit === "g" ? weight / 1000 : weight;
}

export function buildProductDimensions(
  input: ProductPhysicalMetadataInput,
): string | null {
  const parts = [input.width, input.length, input.thickness].filter(
    (value): value is number => value != null && value > 0,
  );
  if (parts.length === 0) return null;
  return `${parts.join("×")}${input.dimUnit ?? "mm"}`;
}

export function computeProductM2PerUnit(
  input: ProductPhysicalMetadataInput,
): string | null {
  if (
    input.width == null || input.length == null ||
    input.width <= 0 || input.length <= 0
  ) return null;
  const factor = input.dimUnit === "mm" ? 0.001 : input.dimUnit === "cm" ? 0.01 : 1;
  const squareMeters = input.width * factor * (input.length * factor);
  return squareMeters > 0 ? squareMeters.toFixed(4) : null;
}

export function productPhysicalMetadataPatch(
  input: ProductPhysicalMetadataInput,
): ProductPhysicalMetadataPatch {
  const patch: ProductPhysicalMetadataPatch = {};
  if (input.weight !== undefined) {
    const weightKg = normalizeProductWeightKg(input.weight, input.weightUnit);
    patch.weight = weightKg == null ? null : String(weightKg);
  }

  const dimensionFields = [input.width, input.length, input.thickness, input.dimUnit];
  if (dimensionFields.some((value) => value !== undefined)) {
    patch.dimensions = buildProductDimensions(input);
    patch.m2PerUnit = computeProductM2PerUnit(input);
  }
  return patch;
}
