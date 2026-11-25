import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const listeners = new Set();
const body = { style: { overflow: "" } };

beforeEach(() => {
  listeners.clear();
  body.style.overflow = "";
  Object.assign(globalThis, {
    document: { body, querySelectorAll: () => [] },
    window: {
      addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

const { getModalLayerCount, getScrollLockCount, lockBodyScroll, pickEscapeLayer, pushModalLayer } =
  await import("./modal-layer.ts");

function pressEscape(init = {}) {
  const event = {
    key: "Escape",
    isComposing: false,
    defaultPrevented: init.defaultPrevented ?? false,
    target: init.target ?? null,
    preventDefault() { this.defaultPrevented = true; },
  };
  for (const fn of [...listeners]) fn(event);
  return event;
}

describe("Escape", () => {
  test("closes only the most recently opened layer", () => {
    const closed = [];
    const a = pushModalLayer({ onEscape: () => closed.push("a") });
    const b = pushModalLayer({ onEscape: () => closed.push("b") });
    expect(b.isTop()).toBe(true);
    expect(a.isTop()).toBe(false);

    const event = pressEscape();
    expect(closed).toEqual(["b"]);
    expect(event.defaultPrevented).toBe(true);

    b.release();
    pressEscape();
    expect(closed).toEqual(["b", "a"]);
    a.release();
    expect(listeners.size).toBe(0);
  });

  test("is left to a picker that already claimed it", () => {
    const closed = [];
    const layer = pushModalLayer({ onEscape: () => closed.push("modal") });
    pressEscape({ defaultPrevented: true });
    expect(closed).toEqual([]);
    layer.release();
  });

  test("ignores keys other than Escape and IME composition", () => {
    expect(pickEscapeLayer({ key: "Enter", defaultPrevented: false, isComposing: false }, [null], null)).toBe(-1);
    expect(pickEscapeLayer({ key: "Escape", defaultPrevented: false, isComposing: true }, [null], null)).toBe(-1);
    expect(pickEscapeLayer({ key: "Escape", defaultPrevented: false, isComposing: false }, [], null)).toBe(-1);
  });

  test("defers to an unregistered modal that holds focus or is open on top", () => {
    const registered = {};
    const unregistered = {};
    const escape = { key: "Escape", defaultPrevented: false, isComposing: false };
    expect(pickEscapeLayer(escape, [registered], unregistered)).toBe(-1);
    expect(pickEscapeLayer(escape, [registered], registered)).toBe(0);
    expect(pickEscapeLayer(escape, [registered], registered, unregistered)).toBe(-1);
    expect(pickEscapeLayer(escape, [registered], null, registered)).toBe(0);
  });
});

describe("scroll lock", () => {
  test("stays locked until the last layer closes, in any order", () => {
    body.style.overflow = "auto";
    const a = pushModalLayer({ lockScroll: true });
    const b = pushModalLayer({ lockScroll: true });
    expect(body.style.overflow).toBe("hidden");

    a.release();
    expect(body.style.overflow).toBe("hidden");
    b.release();
    expect(body.style.overflow).toBe("auto");
    expect(getScrollLockCount()).toBe(0);
    expect(getModalLayerCount()).toBe(0);
  });

  test("release is idempotent", () => {
    const unlock = lockBodyScroll();
    const other = lockBodyScroll();
    unlock();
    unlock();
    expect(body.style.overflow).toBe("hidden");
    other();
    expect(body.style.overflow).toBe("");
  });
});
