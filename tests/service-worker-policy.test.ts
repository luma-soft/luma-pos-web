import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const serviceWorkerSource = readFileSync("public/sw.js", "utf8");

function isIntercepted(path: string, mode: RequestMode = "cors") {
  const listeners: Record<string, (event: unknown) => void> = {};
  const response = { clone: () => response, ok: true, redirected: false };
  const context = {
    URL,
    fetch: () => Promise.resolve(response),
    caches: {
      match: () => Promise.resolve(undefined),
      open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    self: {
      location: { origin: "https://lumapos.shop" },
      clients: { claim: () => Promise.resolve() },
      skipWaiting: () => Promise.resolve(),
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
    },
  };

  vm.runInNewContext(serviceWorkerSource, context);
  let intercepted = false;
  listeners.fetch({
    request: {
      method: "GET",
      mode,
      url: `https://lumapos.shop${path}`,
    },
    respondWith: () => {
      intercepted = true;
    },
  });
  return intercepted;
}

describe("service worker request policy", () => {
  test("does not intercept authenticated App Router pages or RSC payloads", () => {
    expect(isIntercepted("/services", "navigate")).toBe(false);
    expect(isIntercepted("/services?tab=jobs&_rsc=abc")).toBe(false);
    expect(isIntercepted("/api/mobile/services/jobs")).toBe(false);
  });

  test("keeps offline handling scoped to POS navigation and immutable assets", () => {
    expect(isIntercepted("/pos", "navigate")).toBe(true);
    expect(isIntercepted("/_next/static/chunks/app.js")).toBe(true);
    expect(isIntercepted("/icon-192.png")).toBe(true);
  });

  test("serves the worker and manifest outside the authentication proxy", async () => {
    Object.assign(globalThis, { AsyncLocalStorage });
    const [{ unstable_doesMiddlewareMatch }, { config }] = await Promise.all([
      import("next/experimental/testing/server"),
      import("../src/proxy"),
    ]);

    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/sw.js" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/manifest.webmanifest" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/services" })).toBe(true);
  });
});
