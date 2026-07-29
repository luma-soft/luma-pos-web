import { describe, expect, test } from "bun:test";
import type { ProductListResult } from "@/lib/data/products";
import { projectProductUnit } from "@/lib/product-unit-projection";

const cable = {
  baseUnit: "m",
  costPrice: "3500",
  retailPrice: "4400",
  totalStock: "1000",
  reservedStock: "25",
  minLevel: "50",
  unitDefinitions: [
    { unitName: "cuộn", multiplier: "500", priceOverride: "2100000" },
  ],
};

function firstUnit(row: ProductListResult["rows"][number]) {
  return row.unitDefinitions[0];
}

describe("projectProductUnit", () => {
  test("accepts the structured unit contract returned by getProducts", () => {
    const row = {
      unitDefinitions: [
        { unitName: "cuộn", multiplier: "305", priceOverride: "2500000" },
      ],
    } as unknown as ProductListResult["rows"][number];

    expect(firstUnit(row)).toEqual({
      unitName: "cuộn",
      multiplier: "305",
      priceOverride: "2500000",
    });
  });

  test("keeps base-unit values when no alternate unit is selected", () => {
    expect(projectProductUnit(cable)).toEqual({
      unitName: "m",
      multiplier: 1,
      costPrice: 3500,
      retailPrice: 4400,
      totalStock: 1000,
      reservedStock: 25,
      minLevel: 50,
      hasAlternateUnits: true,
    });
  });

  test("multiplies prices and divides quantities for an alternate unit", () => {
    expect(projectProductUnit({
      ...cable,
      selectedUnitName: "cuộn",
      unitDefinitions: [
        { unitName: "cuộn", multiplier: "500", priceOverride: null },
      ],
    })).toEqual({
      unitName: "cuộn",
      multiplier: 500,
      costPrice: 1_750_000,
      retailPrice: 2_200_000,
      totalStock: 2,
      reservedStock: 0.05,
      minLevel: 0.1,
      hasAlternateUnits: true,
    });
  });

  test("uses an alternate unit retail-price override", () => {
    expect(projectProductUnit({
      ...cable,
      selectedUnitName: "cuộn",
    }).retailPrice).toBe(2_100_000);
  });

  test("falls back to the base unit for a stale selection", () => {
    expect(projectProductUnit({
      ...cable,
      selectedUnitName: "không tồn tại",
    })).toMatchObject({
      unitName: "m",
      multiplier: 1,
      costPrice: 3500,
      retailPrice: 4400,
      totalStock: 1000,
    });
  });

  test("normalizes invalid multipliers, overrides, and numeric inputs", () => {
    expect(projectProductUnit({
      ...cable,
      costPrice: "không hợp lệ",
      selectedUnitName: "cuộn",
      unitDefinitions: [
        {
          unitName: "cuộn",
          multiplier: "0",
          priceOverride: "không hợp lệ",
        },
      ],
    })).toMatchObject({
      unitName: "cuộn",
      multiplier: 1,
      costPrice: 0,
      retailPrice: 4400,
      totalStock: 1000,
    });
  });
});
