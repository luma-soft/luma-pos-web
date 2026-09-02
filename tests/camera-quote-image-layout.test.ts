import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/app/(app)/camera-price-list/camera-price-list-client.tsx",
  "utf8",
);

const quoteRenderer = source.match(
  /async function copyQuoteImage[\s\S]*?\n  function copyMenu/,
)?.[0];

describe("camera quote image layout", () => {
  test("renders the suitable-for guidance in copied quote images", () => {
    expect(quoteRenderer).toBeTruthy();
    expect(quoteRenderer).toContain('ctx.fillText("PHÙ HỢP CHO"');
    expect(quoteRenderer).toContain("item.suitableFor.flatMap");
  });

  test("delivers a canvas cropped to the rendered content", () => {
    expect(quoteRenderer).toBeTruthy();
    expect(quoteRenderer).toContain(
      "outputCanvas.height = Math.ceil(contentBottom + 190)",
    );
    expect(quoteRenderer).toContain("canvas: outputCanvas");
  });
});
