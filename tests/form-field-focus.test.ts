import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const formFieldFiles = [
  "src/app/onboarding/onboarding-wizard.tsx",
  "src/app/(app)/inventory/tabs/shopee-listing-modal.tsx",
  "src/app/(app)/partners/tabs/customers-table.tsx",
  "src/app/(app)/partners/tabs/suppliers-table.tsx",
  "src/app/(app)/reports/report-period-filter.tsx",
  "src/app/(app)/settings/settings-client.tsx",
  "src/app/(pos)/pos/pos-client.tsx",
];

describe("form field focus treatment", () => {
  test("uses a single focus border instead of an additional ring", () => {
    for (const file of formFieldFiles) {
      const source = readFileSync(file, "utf8");

      expect(source).not.toMatch(
        /focus:border[^\n]*focus:ring-2|focus:ring-2[^\n]*focus:border|focus:outline-none focus:ring-2 focus:ring-primary-500/,
      );
    }
  });

  test("does not add the global outline to fields with a focus border", () => {
    const source = readFileSync("src/app/globals.css", "utf8");

    expect(source).toMatch(
      /:where\(input, select, textarea\)\[class\*="focus:border-"\]:focus-visible\s*\{[^}]*outline:\s*none;/s,
    );
  });
});
