import { describe, expect, test } from "bun:test";
import { expandPosSearchUnitResults } from "./search-unit-results";

describe("POS search selling units", () => {
  test("shows one result for the base unit and each distinct converted unit", () => {
    const product = {
      id: "pipe",
      baseUnit: "m",
      isVariantParent: false,
      units: [
        { unitName: "cây", multiplier: "4" },
        { unitName: "m", multiplier: "1" },
        { unitName: "cây", multiplier: "4" },
      ],
    };

    expect(expandPosSearchUnitResults([product]).map((row) => ({
      id: row.product.id,
      unitName: row.unitName,
      multiplier: row.alternateUnit?.multiplier ?? "1",
    }))).toEqual([
      { id: "pipe", unitName: "m", multiplier: "1" },
      { id: "pipe", unitName: "cây", multiplier: "4" },
    ]);
  });

  test("keeps a variant parent as one picker result", () => {
    const [row] = expandPosSearchUnitResults([{
      baseUnit: "cái",
      isVariantParent: true,
      units: [{ unitName: "hộp" }],
    }]);

    expect(row.unitName).toBeNull();
    expect(row.alternateUnit).toBeNull();
  });
});
