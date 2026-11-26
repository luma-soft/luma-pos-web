import { readSource } from "../test-support/read-source.mjs";
import { expect, test } from "bun:test";

const component = readSource("./mobile-more-quick-search.tsx", import.meta.url);
const page = readSource("../app/(app)/more/page.tsx", import.meta.url);

test("More search has one results list and hides the menu only on mobile when searching", () => {
  expect(component).toContain('normalizedQuery ? "hidden lg:block lg:space-y-5" : "space-y-8 lg:space-y-5"');
  expect(component).toContain("{children}");
  expect(component).toContain('className="space-y-6 lg:hidden"');
  expect(page).toContain("<MobileMoreQuickSearch");
  expect(page).toContain("</MobileMoreQuickSearch>");
});

test("Search maintains existing role/feature gates rather than discovering hidden destinations", () => {
  expect(page).toContain("...(manager ?");
  expect(page).toContain("...(sales && context.features.camera_quote_builder ?");
  expect(component).toContain('entries.filter((entry)');
  expect(component).toContain('normalize("NFD")');
});
