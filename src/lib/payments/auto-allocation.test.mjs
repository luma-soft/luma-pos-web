import { expect, test } from "bun:test";
import { autoAllocatePayment } from "./auto-allocation";

test("auto allocation pays oldest documents first and preserves display order", () => {
  const items = [
    { id: "new", createdAt: "2026-09-02T00:00:00Z", remaining: 700 },
    { id: "old", createdAt: "2026-09-01T00:00:00Z", remaining: 500 },
  ];
  expect(autoAllocatePayment(800, items)).toEqual([
    { id: "new", amount: 300 },
    { id: "old", amount: 500 },
  ]);
});

test("auto allocation leaves only the true excess unallocated", () => {
  const items = [{ id: "invoice", createdAt: "2026-09-01T00:00:00Z", remaining: 500 }];
  expect(autoAllocatePayment(650, items)).toEqual([{ id: "invoice", amount: 500 }]);
});

test("supplier allocation can prioritize the newest receipt", () => {
  const items = [
    { id: "new", createdAt: "2026-09-02T00:00:00Z", remaining: 700 },
    { id: "old", createdAt: "2026-09-01T00:00:00Z", remaining: 500 },
  ];
  expect(autoAllocatePayment(600, items, "newest")).toEqual([
    { id: "new", amount: 600 },
    { id: "old", amount: 0 },
  ]);
});
