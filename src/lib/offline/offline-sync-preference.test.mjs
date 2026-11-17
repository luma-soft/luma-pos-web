import { afterAll, beforeEach, expect, test } from "bun:test";

const storage = new Map();
const previousWindow = globalThis.window;
globalThis.window = {
  location: { hostname: "pos.example.test" },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
  dispatchEvent: () => true,
};
globalThis.CustomEvent ??= class CustomEvent { constructor(type) { this.type = type; } };

const {
  isOfflineSyncEnabled,
  isStoreOfflinePolicyEnabled,
  setOfflineSyncEnabled,
  writeStoreOfflinePolicy,
} = await import("./offline-sync-preference.ts");

afterAll(() => {
  // Other offline tests in this process read the switch from `window`.
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

beforeEach(() => {
  storage.clear();
  window.location.hostname = "pos.example.test";
});

test("store policy off forces offline sync off on every browser", () => {
  setOfflineSyncEnabled(true);
  expect(isOfflineSyncEnabled()).toBe(true);
  expect(writeStoreOfflinePolicy(false)).toBe(true);
  expect(isStoreOfflinePolicyEnabled()).toBe(false);
  expect(isOfflineSyncEnabled()).toBe(false);
});

test("store policy on keeps the per-browser choice", () => {
  expect(writeStoreOfflinePolicy(true)).toBe(false);
  expect(isOfflineSyncEnabled()).toBe(true);
  setOfflineSyncEnabled(false);
  expect(isOfflineSyncEnabled()).toBe(false);
});

test("re-enabling the store policy is not reported as a disable", () => {
  writeStoreOfflinePolicy(false);
  expect(writeStoreOfflinePolicy(true)).toBe(false);
  expect(isOfflineSyncEnabled()).toBe(true);
});

test("the store Mac stays local-only", () => {
  window.location.hostname = "127.0.0.1";
  writeStoreOfflinePolicy(true);
  expect(isOfflineSyncEnabled()).toBe(false);
});
