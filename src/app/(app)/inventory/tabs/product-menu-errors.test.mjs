import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const products = readFileSync(new URL("./products-table.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../../partners/tabs/customer-mobile.tsx", import.meta.url), "utf8");

// The phone "…" sheet closes when an action is chosen, so failures must be alerts.
test("phone product actions report failures in an alert", () => {
  expect(products).toContain('if (variant === "menu") void dialog.alert({ description: message, variant: "destructive" });');
  expect(products).toContain("} else showError(t(res.error as never));");
  const menu = products.slice(products.indexOf('if (variant === "menu") {\n'), products.indexOf("  return (\n    <div className=\"border-t border-border-soft pt-4 max-lg:hidden\">"));
  expect(menu).not.toContain("{error &&");
});

test("stopping a customer from the phone sheet reports failures", () => {
  expect(customers).toContain('await dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });');
});
