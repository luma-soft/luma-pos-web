import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const pos = readFileSync(new URL("./pos-client.tsx", import.meta.url), "utf8");
const tabs = pos.slice(pos.indexOf("  const invoiceTabs = ("), pos.indexOf("  // Danh sách dòng hàng đã chọn", pos.indexOf("  const invoiceTabs = (")));

test("iPhone POS uses a compact current-draft selector and a single reusable draft list", () => {
  expect(tabs).toContain('aria-haspopup="dialog"');
  expect(tabs).toContain("mobileInvoicePickerOpen");
  expect(tabs.match(/invoices\.map\(/g)?.length).toBe(1);
  expect(tabs).toContain("lg:static lg:flex");
  expect(tabs).toContain("lg:whitespace-nowrap");
});

test("all POS draft actions remain accessible in the sheet", () => {
  expect(tabs).toContain("setActiveId(inv.id)");
  expect(tabs).toContain('key: "rename"');
  expect(tabs).toContain('key: "change-type"');
  expect(tabs).toContain('key: "delete"');
  expect(tabs).toContain("toggleAddMenu()");
  expect(tabs).toContain("setMobileInvoicePickerOpen(false)");
  expect(pos).toContain("menuHeight = 4 * 44 + 16");
  expect(pos).toContain("savePosDraftSnapshot");
});
