import { describe, expect, test } from "bun:test";
import { priceBookApprovalScope } from "../src/lib/pricing/price-book-approval";

describe("price-book sensitive approval", () => {
  test("binds creation approval to the price-book create action", () => {
    expect(priceBookApprovalScope({ action: "create" })).toBe(
      "settings:price-books:create",
    );
  });

  test("binds rename and delete approval to one exact price book", () => {
    expect(priceBookApprovalScope({ action: "rename", id: "book-1" })).toBe(
      "settings:price-books:book-1:rename",
    );
    expect(priceBookApprovalScope({ action: "delete", id: "book-1" })).toBe(
      "settings:price-books:book-1:delete",
    );
  });
});
