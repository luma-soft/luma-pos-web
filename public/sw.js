/* LumaPOS PWA: cache only public, immutable app assets.
   NEVER persist authenticated HTML/RSC/API: /pos includes store/customer data.
   Running POS keeps its own scoped IndexedDB/local drafts while offline. */
const CACHE = "lumapos-static-v7";
const APP_SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-180.png"];
const OFFLINE_DOCUMENT = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Required: a generic offline fallback with NO tenant/user/order data.
    await cache.add(OFFLINE_DOCUMENT);
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("lumapos-") && name !== CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || /^\/icon(?:-|\.)/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) {
        const copy = response.clone();
        const cache = await caches.open(CACHE);
        await cache.put(req, copy);
      }
      return response;
    })());
    return;
  }

  // Network-first navigations; never cache personalized HTML from any route.
  // On offline cold launch, return a public recovery shell instead of a
  // previous account's sensitive POS page. An already loaded POS can still
  // work against its user/store-scoped local catalog/outbox.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_DOCUMENT)) ?? Response.error())
    );
  }
  // All RSC, API and data requests pass through directly without CacheStorage.
});
