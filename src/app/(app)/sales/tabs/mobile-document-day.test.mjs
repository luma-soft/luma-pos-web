import { expect, test } from "bun:test";
import { mobileDocumentDay, mobileDocumentDayHeadings } from "./mobile-document-day.ts";

test("local day headings appear only for the first row in consecutive date groups", () => {
  const rows = [
    { id: "a", createdAt: "2026-11-08T07:00:00Z" },
    { id: "b", createdAt: "2026-11-08T10:00:00Z" },
    { id: "c", createdAt: "2026-11-07T08:00:00Z" },
  ];
  const groups = mobileDocumentDayHeadings(rows, (row) => row.createdAt);
  expect(groups.get("a")).toBeTruthy();
  expect(groups.has("b")).toBe(false);
  expect(groups.get("c")).toBeTruthy();
});
test("bookings can group by delivery date and invalid dates produce no heading", () => {
  const rows = [{ id: "x", deliveryDate: "2026-11-10T09:00:00Z", createdAt: "2026-11-08T09:00:00Z" }];
  expect(mobileDocumentDayHeadings(rows, (row) => row.deliveryDate).get("x")).toBe(mobileDocumentDay(rows[0].deliveryDate));
  expect(mobileDocumentDay("not a date")).toBe("");
});
