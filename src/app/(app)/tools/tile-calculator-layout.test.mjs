import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const calculator = readFileSync(
  new URL("./tile-calculator.tsx", import.meta.url),
  "utf8",
);

test("the room navigator keeps cards readable and reveals the active room", () => {
  expect(calculator).toContain("activeRoomRef.current?.scrollIntoView");
  expect(calculator).toContain("snap-x snap-mandatory");
  expect(calculator).toContain("w-[15rem] shrink-0 snap-start");
});

test("pricing follows openings and keeps controls readable", () => {
  const openings = calculator.indexOf('title={t("openings")}');
  const pricing = calculator.indexOf('title={t("pricing")}');

  expect(openings).toBeGreaterThan(-1);
  expect(pricing).toBeGreaterThan(openings);
  expect(calculator).toContain("xl:grid-cols-2");
  expect(calculator).toContain('className="xl:col-span-2"');
  expect(calculator).toContain('<legend className="sr-only">{title}</legend>');
});

test("calculator controls compose the shared design-system components", () => {
  expect(calculator).toContain('import { QuantityInput } from "@/components/ui/quantity-input"');
  expect(calculator).toContain('import { Section } from "@/components/ui/section"');
  expect(calculator).toContain("<QuantityInput");
  expect(calculator).toContain("<Section");
  expect(calculator).not.toContain("<details");
  expect(calculator).not.toContain('<input aria-label={label} inputMode="numeric"');
});
