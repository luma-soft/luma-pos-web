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
