import { describe, expect, test } from "bun:test";
import { buildAttributeNameOptions } from "../src/app/(app)/products/new/attribute-name-options";

describe("product attribute name options", () => {
  test("preserves a custom attribute name loaded from product specs", () => {
    const options = buildAttributeNameOptions("Kết nối");

    expect(options).toContainEqual({ value: "Kết nối", label: "Kết nối" });
  });

  test("does not duplicate a preset attribute name", () => {
    const options = buildAttributeNameOptions("Màu sắc");

    expect(options.filter((option) => option.value === "Màu sắc")).toHaveLength(1);
  });

  test("does not add an empty custom option", () => {
    const options = buildAttributeNameOptions("");

    expect(options.some((option) => option.value === "")).toBe(false);
  });
});
