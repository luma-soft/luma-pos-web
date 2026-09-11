import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterTriggerButton } from "./list-search-filter";
import { hasActiveOrderFilters } from "../app/(app)/sales/tabs/orders-filter-drawer";
import { hasActiveDocumentFilters } from "../app/(app)/sales/tabs/document-filter-drawer";

const baseOrder = {
  q: "",
  customerId: "",
  customerLabel: "",
  productId: "",
  productLabel: "",
  status: "all",
  payment: "all",
  paymentMethod: "all",
  source: "all",
  timePreset: "all",
  from: "",
  to: "",
  minTotal: "",
  maxTotal: "",
  includeCancelled: false,
};

test("shared web filter trigger renders an explicit highlighted active state", () => {
  const inactive = renderToStaticMarkup(createElement(FilterTriggerButton, {
    label: "Lọc",
  }));
  const active = renderToStaticMarkup(createElement(FilterTriggerButton, {
    label: "Lọc",
    active: true,
  }));

  expect(inactive).toContain('aria-pressed="false"');
  expect(active).toContain('aria-pressed="true"');
  expect(active).toContain("bg-primary-50");
  expect(active).toContain("ring-primary-200");
});

test("order filter trigger ignores search but highlights applied filters", () => {
  expect(hasActiveOrderFilters(baseOrder)).toBe(false);
  expect(hasActiveOrderFilters({ ...baseOrder, q: "HD001" })).toBe(false);
  expect(hasActiveOrderFilters({ ...baseOrder, status: "completed" })).toBe(true);
  expect(hasActiveOrderFilters({ ...baseOrder, minTotal: "100000" })).toBe(true);
});

test("document filter trigger respects defaults for every sales tab", () => {
  const baseDocument = {
    q: "",
    customerId: "",
    customerLabel: "",
    productId: "",
    productLabel: "",
    timePreset: "all",
    from: "",
    to: "",
    minTotal: "",
    maxTotal: "",
  };

  expect(hasActiveDocumentFilters("quotes", { ...baseDocument, status: "quote" })).toBe(false);
  expect(hasActiveDocumentFilters("quotes", { ...baseDocument, status: "cancelled" })).toBe(true);
  expect(hasActiveDocumentFilters("returns", { ...baseDocument, reason: "all", refundMethod: "all" })).toBe(false);
  expect(hasActiveDocumentFilters("returns", { ...baseDocument, reason: "damaged" })).toBe(true);
  expect(hasActiveDocumentFilters("bookings", { ...baseDocument, status: "all", payment: "all", deliveryPreset: "all" })).toBe(false);
  expect(hasActiveDocumentFilters("bookings", { ...baseDocument, payment: "unpaid" })).toBe(true);
});
