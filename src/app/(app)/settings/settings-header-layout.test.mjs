import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsClient = readFileSync(
  new URL("./settings-client.tsx", import.meta.url),
  "utf8",
);

test("tax sticky header can reach the top of its scroll container", () => {
  expect(settingsClient).toContain(
    'active === "tax" ? "pt-3 md:pt-0 md:pb-6" : "py-3 md:py-6"',
  );
  expect(settingsClient).toContain(
    'active === "tax" && "md:pt-4"',
  );
});
