import { describe, expect, test } from "bun:test";
import { positionFloatingMenu } from "@/lib/floating-menu-position";

describe("floating menu positioning", () => {
  test("places a wide action menu above a bottom-right mobile trigger", () => {
    const result = positionFloatingMenu({
      trigger: {
        left: 332,
        right: 376,
        top: 736,
        bottom: 780,
      },
      menu: { width: 208, height: 240 },
      viewport: { width: 393, height: 852 },
      margin: 8,
      gap: 4,
    });

    expect(result).toEqual({
      left: 168,
      top: 492,
      maxHeight: 724,
    });
  });

  test("honors a preferred bottom side when both sides have room", () => {
    const result = positionFloatingMenu({
      trigger: { left: 500, right: 544, top: 360, bottom: 404 },
      menu: { width: 224, height: 142 },
      viewport: { width: 1280, height: 800 },
      preferredSide: "bottom",
      margin: 8,
      gap: 4,
    });

    expect(result.top).toBe(408);
  });

  test("honors a preferred top side when both sides have room", () => {
    const result = positionFloatingMenu({
      trigger: { left: 500, right: 544, top: 360, bottom: 404 },
      menu: { width: 224, height: 142 },
      viewport: { width: 1280, height: 800 },
      preferredSide: "top",
      margin: 8,
      gap: 4,
    });

    expect(result.top).toBe(214);
  });

  test("flips a bottom menu above when the viewport has too little room below", () => {
    const result = positionFloatingMenu({
      trigger: { left: 500, right: 544, top: 700, bottom: 744 },
      menu: { width: 224, height: 142 },
      viewport: { width: 1280, height: 800 },
      preferredSide: "bottom",
      margin: 8,
      gap: 4,
    });

    expect(result.top).toBe(554);
    expect(result.maxHeight).toBe(688);
  });
});
