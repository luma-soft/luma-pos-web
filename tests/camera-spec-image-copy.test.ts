import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/app/(app)/camera-price-list/camera-price-list-client.tsx",
  "utf8",
);

describe("camera specification image copy", () => {
  test("offers a dedicated specification-only image action", () => {
    expect(source).toContain("async function copySpecsImage");
    expect(source).toContain("Sao chép ảnh thông số");
    expect(source).toContain("Sao chép thông số");
  });

  test("keeps prices out of the specification-only canvas", () => {
    const renderer = source.match(
      /async function copySpecsImage[\s\S]*?\n  async function copyImage/,
    )?.[0];

    expect(renderer).toBeTruthy();
    expect(renderer).toContain('ctx.fillText("THÔNG SỐ KỸ THUẬT"');
    expect(renderer).toContain("detailsFor(item)");
    expect(renderer).not.toContain("formatCurrency");
    expect(renderer).not.toContain("item.variants");
  });
});
