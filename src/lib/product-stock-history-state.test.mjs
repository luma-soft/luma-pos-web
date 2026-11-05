import { expect, test } from "bun:test";
import { resolveProductStockHistoryPanelState } from "./product-stock-history-state";

const expected = { scopeId: "store:user:manager", productId: "product-a", page: 1 };

test("cached stock history remains available offline", () => {
  expect(resolveProductStockHistoryPanelState({
    ...expected,
    rows: [{ id: "movement-1" }],
  }, expected, "ready")).toBe("ready");
});

test("uncached offline stock history is unavailable instead of falsely empty", () => {
  expect(resolveProductStockHistoryPanelState(null, expected, "offline"))
    .toBe("offline-unavailable");
});

test("an empty state is shown only after the matching history page was fetched", () => {
  expect(resolveProductStockHistoryPanelState({ ...expected, rows: [] }, expected, "ready"))
    .toBe("empty");
  expect(resolveProductStockHistoryPanelState({
    ...expected,
    scopeId: "store:other-user:manager",
    rows: [],
  }, expected, "offline")).toBe("offline-unavailable");
});
