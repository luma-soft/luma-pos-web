import { describe, expect, test } from "bun:test";
import { expandPosSearchUnitResults, rankProductSearchUnitResults } from "./search-unit-results";

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

  test("cached ranking facts match uncached results when the query changes", () => {
    const products = [
      {
        id: "elbow-110",
        name: "Cút góc PVC 110",
        sku: "CUT-110",
        barcode: "893110",
        baseUnit: "cái",
        baseUnitDirectSale: true,
        isVariantParent: false,
        units: [{ unitName: "cây", sku: "CUT-110-CAY", directSale: true }],
      },
      {
        id: "pipe-110",
        name: "Ống PVC 110",
        sku: "ONG-110",
        barcode: null,
        baseUnit: "cây",
        baseUnitDirectSale: true,
        isVariantParent: false,
        units: [{ unitName: "bó", sku: null, directSale: true }],
      },
    ];
    const rows = expandPosSearchUnitResults(products);
    const label = (product) => product.name;
    const factsCache = new WeakMap();

    for (const query of ["cút 110", "cây", "PVC 110", "110 cút", "ống bó"]) {
      expect(rankProductSearchUnitResults(rows, query, label, {
        sellableOnly: true,
        factsCache,
      })).toEqual(rankProductSearchUnitResults(rows, query, label, { sellableOnly: true }));
    }

    expect(rankProductSearchUnitResults(rows, "cút 110", label, {
      sellableOnly: true,
      factsCache,
    }).map(({ product, unitName }) => [product.id, unitName])).toEqual([
      ["elbow-110", "cái"],
      ["elbow-110", "cây"],
      ["pipe-110", "cây"],
      ["pipe-110", "bó"],
    ]);
  });
});
