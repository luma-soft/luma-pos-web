import { afterEach, expect, test } from "bun:test";
import { updateModalUrlQuery } from "./modal-url-query";

const originalWindow = globalThis.window;
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

function createWindow(initialUrl) {
  let href = initialUrl;
  const events = [];
  globalThis.window = {
    location: { get href() { return href; } },
    history: {
      pushState(state, _unused, target) {
        events.push({ method: "push", state, target });
        href = new URL(target, href).href;
      },
      replaceState(state, _unused, target) {
        events.push({ method: "replace", state, target });
        href = new URL(target, href).href;
      },
    },
  };
  return { events, get url() { return new URL(href); } };
}

test("opening local detail changes only overlay fields and retains page and hash", () => {
  const win = createWindow("https://example.test/partners?tab=customers&page=3&q=Anh#list");
  updateModalUrlQuery({ detailCustomerId: "customer-2", detailSupplierId: null }, "push");
  expect(win.events).toEqual([{ method: "push", state: null, target: "/partners?tab=customers&page=3&q=Anh&detailCustomerId=customer-2#list" }]);
  expect(win.url.searchParams.get("q")).toBe("Anh");
  expect(win.url.searchParams.get("page")).toBe("3");
});

test("closing a selected overlay only updates the URL without a navigation request", () => {
  const win = createWindow("https://example.test/inventory?tab=purchases&page=4&detailPurchaseId=123#bottom");
  updateModalUrlQuery({ detailPurchaseId: null });
  expect(win.events).toEqual([{ method: "replace", state: null, target: "/inventory?tab=purchases&page=4#bottom" }]);
  expect(win.url.searchParams.has("detailPurchaseId")).toBe(false);
});

test("no URL update occurs if overlay state already matches", () => {
  const win = createWindow("https://example.test/sales?tab=orders&q=a");
  updateModalUrlQuery({ detailOrderId: null });
  expect(win.events).toEqual([]);
});
