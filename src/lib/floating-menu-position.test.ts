import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { positionFloatingMenu } from "./floating-menu-position";

describe("positionFloatingMenu", () => {
  test("flips a top menu below its trigger when the viewport top would clip it", () => {
    assert.deepEqual(positionFloatingMenu({
      trigger: { left: 700, right: 900, top: 90, bottom: 130 },
      menu: { width: 208, height: 150 },
      viewport: { width: 1000, height: 700 },
      preferredSide: "top",
      gap: 8,
    }), { left: 692, top: 138, maxHeight: 554 });
  });

  test("keeps a menu inside the horizontal viewport margin", () => {
    assert.equal(positionFloatingMenu({
      trigger: { left: 4, right: 44, top: 200, bottom: 240 },
      menu: { width: 300, height: 120 },
      viewport: { width: 360, height: 640 },
    }).left, 8);
  });

  test("caps a tall menu to the available viewport height", () => {
    assert.equal(positionFloatingMenu({
      trigger: { left: 300, right: 500, top: 250, bottom: 290 },
      menu: { width: 240, height: 900 },
      viewport: { width: 800, height: 600 },
      preferredSide: "bottom",
      gap: 8,
    }).maxHeight, 294);
  });
});
