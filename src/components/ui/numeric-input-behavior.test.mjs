import { describe, expect, test } from "bun:test";

describe("shared numeric input behavior", () => {
  test("NumberInput and MoneyInput use the shared focus and text guard", async () => {
    const [numberInput, moneyInput] = await Promise.all([
      Bun.file(new URL("./number-input.tsx", import.meta.url)).text(),
      Bun.file(new URL("./money-input.tsx", import.meta.url)).text(),
    ]);
    for (const source of [numberInput, moneyInput]) {
      expect(source).toContain("useNumericInputBehavior");
      expect(source).toContain("onBeforeInput");
      expect(source).toContain("onPaste");
    }
  });
});
