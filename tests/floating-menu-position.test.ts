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
});
