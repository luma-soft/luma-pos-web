import { describe, expect, test } from "bun:test";
import { upsertPosCartLine } from "./cart-line-order";

describe("POS cart line ordering", () => {
  test("places a newly added product at the top", () => {
    const current = [{ id: "first", quantity: 1 }, { id: "second", quantity: 1 }];
    const next = upsertPosCartLine(
      current,
      (line) => line.id === "new",
      () => ({ id: "new", quantity: 1 }),
      (line) => ({ ...line, quantity: line.quantity + 1 }),
    );
    expect(next.map((line) => line.id)).toEqual(["new", "first", "second"]);
  });

  test("increments an existing product without reordering the invoice", () => {
    const current = [{ id: "first", quantity: 1 }, { id: "second", quantity: 1 }];
    const next = upsertPosCartLine(
      current,
      (line) => line.id === "second",
      () => ({ id: "second", quantity: 1 }),
      (line) => ({ ...line, quantity: line.quantity + 1 }),
    );
    expect(next).toEqual([{ id: "first", quantity: 1 }, { id: "second", quantity: 2 }]);
  });
});
