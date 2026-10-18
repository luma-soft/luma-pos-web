import { expect, test } from "bun:test";
import { shouldRefreshDeferredAppPath } from "./deferred-app-route-refresh";

test("waits until a saved product modal has returned to the target list", () => {
  expect(shouldRefreshDeferredAppPath({
    routeChanged: true,
    pendingPath: "/inventory",
    currentPath: "/products/product-id",
    modalOpen: false,
  })).toBe(false);

  expect(shouldRefreshDeferredAppPath({
    routeChanged: true,
    pendingPath: "/inventory",
    currentPath: "/inventory",
    modalOpen: true,
  })).toBe(false);

  expect(shouldRefreshDeferredAppPath({
    routeChanged: true,
    pendingPath: "/inventory",
    currentPath: "/inventory",
    modalOpen: false,
  })).toBe(true);
});

test("does not refresh on the initial route render", () => {
  expect(shouldRefreshDeferredAppPath({
    routeChanged: false,
    pendingPath: "/inventory",
    currentPath: "/inventory",
    modalOpen: false,
  })).toBe(false);
});
