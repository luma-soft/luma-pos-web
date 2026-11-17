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

const { isOfflineSyncEnabled, setOfflineSyncEnabled } = await import("./offline-sync-preference.ts");

afterAll(() => {
  // Other offline tests in this process read the switch from `window`.
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

beforeEach(() => {
  storage.clear();
  window.location.hostname = "pos.example.test";
});

test("each browser defaults on and keeps its own choice", () => {
  expect(isOfflineSyncEnabled()).toBe(true);
  setOfflineSyncEnabled(false);
  expect(isOfflineSyncEnabled()).toBe(false);
  setOfflineSyncEnabled(true);
  expect(isOfflineSyncEnabled()).toBe(true);
});

test("the store Mac stays local-only", () => {
  window.location.hostname = "127.0.0.1";
  setOfflineSyncEnabled(true);
  expect(isOfflineSyncEnabled()).toBe(false);
});
