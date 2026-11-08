import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./mobile-more-quick-search.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(app)/more/page.tsx", import.meta.url), "utf8");

test("More search has one results list and hides the menu only on mobile when searching", () => {
  expect(component).toContain('normalizedQuery ? "hidden lg:block lg:space-y-5" : "space-y-5"');
  expect(component).toContain("{children}");
  expect(component).toContain('className="space-y-2 lg:hidden"');
  expect(page).toContain("<MobileMoreQuickSearch");
  expect(page).toContain("</MobileMoreQuickSearch>");
});

test("Search maintains existing role/feature gates rather than discovering hidden destinations", () => {
  expect(page).toContain("...(manager ?");
  expect(page).toContain("...(sales && context.features.camera_quote_builder ?");
  expect(component).toContain('entries.filter((entry)');
  expect(component).toContain('normalize("NFD")');
});
