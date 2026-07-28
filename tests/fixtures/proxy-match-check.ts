import { AsyncLocalStorage } from "node:async_hooks";

Object.assign(globalThis, { AsyncLocalStorage });

const [{ unstable_doesMiddlewareMatch }, { config }] = await Promise.all([
  import("next/experimental/testing/server"),
  import("../../src/proxy"),
]);

const result = {
  serviceWorker: unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url: "/sw.js",
  }),
  manifest: unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url: "/manifest.webmanifest",
  }),
  authenticatedRoute: unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url: "/services",
  }),
};

console.log(JSON.stringify(result));
