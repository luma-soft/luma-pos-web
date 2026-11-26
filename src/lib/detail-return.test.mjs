import { describe, expect, test } from "bun:test";
import { detailReturnAction, rememberDetailNavigation, safeReturnHref, withReturnTo } from "./detail-return.ts";

describe("detail return", () => {
  test("adds returnTo only when the detail lives on another page", () => {
    expect(withReturnTo("/partners?tab=suppliers&detailSupplierId=s1", "/inventory?tab=purchases&page=2"))
      .toBe("/partners?tab=suppliers&detailSupplierId=s1&returnTo=%2Finventory%3Ftab%3Dpurchases%26page%3D2");
    expect(withReturnTo("/partners?tab=suppliers&detailSupplierId=s1", "/partners?tab=projects"))
      .toBe("/partners?tab=suppliers&detailSupplierId=s1");
  });

  test("goes back when this tab followed the link, else replaces with the origin", () => {
    rememberDetailNavigation("/inventory?tab=purchases");
    expect(detailReturnAction("/inventory?tab=purchases")).toEqual({ kind: "back" });
    // Consumed: a reload or a later close no longer assumes history.
    expect(detailReturnAction("/inventory?tab=purchases")).toEqual({ kind: "replace", href: "/inventory?tab=purchases" });
    expect(detailReturnAction(null)).toEqual({ kind: "none" });
  });

  test("rejects off-site return targets", () => {
    for (const value of ["https://evil.test/x", "//evil.test", "javascript:alert(1)", ""]) {
      expect(safeReturnHref(value)).toBeNull();
      expect(detailReturnAction(value)).toEqual({ kind: "none" });
    }
    expect(safeReturnHref("/sales?tab=orders#x")).toBe("/sales?tab=orders#x");
  });
});
