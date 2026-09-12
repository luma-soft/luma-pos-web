import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./settings-client.tsx", import.meta.url),
  "utf8",
);

test("the opened bank picker overlays the form instead of changing its layout", () => {
  assert.match(
    source,
    /className="absolute inset-x-0 top-full z-\[\d+\] mt-1 overflow-hidden/,
  );
});

test("the default account star has a selected visual state", () => {
  assert.match(source, /account\.isDefault && "[^"]*bg-primary-[^"]*"/);
  assert.match(
    source,
    /<Star className=\{cn\("w-3\.5 h-3\.5", account\.isDefault && "fill-current"\)\}/,
  );
});
