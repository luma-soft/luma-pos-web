import { expect, test } from "bun:test";
import { mobileDocumentCompactTotal, mobileDocumentDay, mobileDocumentDayGroups, mobileDocumentDayHeadings } from "./mobile-document-day.ts";

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

test("native day groups carry today/yesterday titles and the day's count and compact total", () => {
  const now = new Date(2026, 10, 17, 21, 0);
  const rows = [
    { id: "a", createdAt: new Date(2026, 10, 17, 20, 14), total: 24_222_000 },
    { id: "b", createdAt: new Date(2026, 10, 17, 19, 44), total: 10_690_000 },
    { id: "c", createdAt: new Date(2026, 10, 16, 9, 0), total: 300_000 },
  ];
  const groups = mobileDocumentDayGroups(rows, (row) => row.createdAt, (row) => row.total, {
    locale: "vi",
    today: (date) => `Hôm nay · ${date}`,
    yesterday: (date) => `Hôm qua · ${date}`,
    summary: (count, total) => `${count} đơn · ${total}`,
  }, now);
  expect(groups.get("a")).toEqual({ title: "Hôm nay · 17/11/2026", summary: "2 đơn · 34,91 triệu" });
  expect(groups.has("b")).toBe(false);
  expect(groups.get("c")).toEqual({ title: "Hôm qua · 16/11/2026", summary: "1 đơn · 300 nghìn" });
  expect(mobileDocumentCompactTotal(950, "vi")).toBe("950 ₫");
});
