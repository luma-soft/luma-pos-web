import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("sales primary actions", () => {
  test("renders the active tab action beside the shared tab navigation", () => {
    const page = read("src/app/(app)/sales/page.tsx");

    expect(page).toContain("<GroupTabs");
    expect(page).toMatch(/<SalesPrimaryAction\s+tab=\{tab\}/);
    expect(page).toContain('tab === "orders"');
    expect(page).toContain('tab === "returns"');
    expect(page).toContain('tab === "quotes"');
    expect(page).toContain('tab === "bookings"');
  });

  test("does not leave duplicate create actions in tab content", () => {
    for (const path of [
      "src/app/(app)/sales/tabs/orders.tsx",
      "src/app/(app)/sales/tabs/returns.tsx",
      "src/app/(app)/sales/tabs/quotes.tsx",
      "src/app/(app)/sales/tabs/bookings.tsx",
    ]) {
      expect(read(path)).not.toContain("ml-auto");
    }
  });

  test("uses the shared default button height for the active tab action", () => {
    const page = read("src/app/(app)/sales/page.tsx");

    expect(page).toContain('buttonVariants({ size: "default" })');
    expect(page).not.toContain("lg:min-h-0");
  });
});
