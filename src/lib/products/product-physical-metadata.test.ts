import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProductDimensions,
  computeProductM2PerUnit,
  normalizeProductWeightKg,
  productPhysicalMetadataPatch,
} from "./product-physical-metadata";

test("physical metadata stores grams as kilograms like product creation", () => {
  assert.equal(normalizeProductWeightKg(750, "g"), 0.75);
  assert.equal(normalizeProductWeightKg(2.5, "kg"), 2.5);
  assert.equal(normalizeProductWeightKg(null, "g"), null);
});

test("physical metadata serializes dimensions and square meters in selected units", () => {
  const dimensions = { width: 600, length: 600, thickness: 9, dimUnit: "mm" as const };
  assert.equal(buildProductDimensions(dimensions), "600×600×9mm");
  assert.equal(computeProductM2PerUnit(dimensions), "0.3600");
  assert.equal(
    computeProductM2PerUnit({ width: 60, length: 60, dimUnit: "cm" }),
    "0.3600",
  );
});

test("clearing dimensions clears both stored dimensions and derived area", () => {
  assert.deepEqual(
    productPhysicalMetadataPatch({
      width: null,
      length: null,
      thickness: null,
      dimUnit: "mm",
    }),
    { dimensions: null, m2PerUnit: null },
  );
});

test("omitted physical fields remain absent from an update patch", () => {
  assert.deepEqual(productPhysicalMetadataPatch({}), {});
});
