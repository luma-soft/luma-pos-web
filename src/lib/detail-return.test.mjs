import { describe, expect, test } from "bun:test";
import { detailReturnAction, isEditorLocation, modalCloseAction, openerEntry, rememberDetailNavigation, resolveDetailHref, safeReturnHref, withReturnTo } from "./detail-return.ts";

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

describe("record links keep the current page", () => {
  const origin = "/notifications?tab=activity&page=2";

  test("orders and purchases open in place", () => {
    expect(resolveDetailHref("/sales?tab=orders&detailOrderId=o1", origin))
      .toEqual({ href: "/notifications?tab=activity&page=2&detailOrderId=o1", remember: false });
    expect(resolveDetailHref("/purchases/p1", origin))
      .toEqual({ href: "/notifications?tab=activity&page=2&detailPurchaseId=p1", remember: false });
    expect(resolveDetailHref("/purchases/new", origin).href).toBe("/purchases/new");
  });

  test("partners carry returnTo", () => {
    const resolved = resolveDetailHref("/partners?tab=customers&detailCustomerId=c1", origin);
    expect(resolved.remember).toBe(true);
    expect(new URL(resolved.href, "http://x").searchParams.get("returnTo")).toBe(origin);
  });

  test("other links are unchanged", () => {
    for (const href of ["/products/x", "/projects/y", "/pos", "https://example.com/a"]) {
      expect(resolveDetailHref(href, origin)).toEqual({ href, remember: false });
    }
  });
});

describe("route-backed modal close", () => {
  function withHistory(previousUrl, run) {
    globalThis.window = {
      location: { origin: "http://luma.local" },
      navigation: previousUrl
        ? { currentEntry: { index: 1 }, entries: () => [{ url: `http://luma.local${previousUrl}` }, { url: "http://luma.local/now" }] }
        : { currentEntry: { index: 0 }, entries: () => [{ url: "http://luma.local/now" }] },
    };
    try { run(); } finally { delete globalThis.window; }
  }

  test("goes back to the opener, else to the fallback", () => {
    withHistory("/inventory?tab=products&q=den", () => {
      expect(modalCloseAction("/inventory?tab=products")).toEqual({ kind: "back" });
    });
    withHistory("/inventory?tab=stock&stockStatus=lowStock&page=2", () => {
      const isOpener = (previous) => !previous.searchParams.has("stockStatus");
      expect(modalCloseAction("/inventory?tab=stock", isOpener)).toEqual({ kind: "replace", href: "/inventory?tab=stock" });
    });
    withHistory(null, () => {
      expect(modalCloseAction("/inventory?tab=products")).toEqual({ kind: "replace", href: "/inventory?tab=products" });
    });
  });

  test("partner detail goes back when the previous entry is returnTo", () => {
    withHistory("/inventory?tab=purchases", () => {
      expect(detailReturnAction("/inventory?tab=purchases")).toEqual({ kind: "back" });
    });
  });
});

describe("forms return to their opener", () => {
  test("editors and print pages are never openers", () => {
    for (const href of ["/purchases/new?productId=x", "/purchases/p1/edit", "/orders/o1/print", "/inventory?tab=products&productModal=create"]) {
      expect(isEditorLocation(new URL(href, "http://luma.local"))).toBe(true);
    }
    expect(isEditorLocation(new URL("/notifications?detailPurchaseId=p1", "http://luma.local"))).toBe(false);
  });

  test("openerEntry skips an editor history entry", () => {
    globalThis.window = {
      location: { origin: "http://luma.local" },
      navigation: { currentEntry: { index: 1 }, entries: () => [{ url: "http://luma.local/products/new?productModal=create" }, { url: "http://luma.local/purchases/new" }] },
    };
    try { expect(openerEntry()).toBeNull(); } finally { delete globalThis.window; }
  });
});
