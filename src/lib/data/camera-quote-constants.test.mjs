import { describe, expect, test } from "bun:test";

import {
  CAMERA_QUOTE_CARD_SKUS,
  CAMERA_QUOTE_DEFAULT_CARD_SKU,
} from "./camera-quote-constants.ts";

describe("camera quote memory cards", () => {
  test("uses the stocked Lexar 64GB SKU for the default package", () => {
    expect(CAMERA_QUOTE_CARD_SKUS).toContain("SP7F7D2202241D-A832AE");
    expect(CAMERA_QUOTE_CARD_SKUS).toContain("SP7F7D2202241D-EBF5B9");
    expect(CAMERA_QUOTE_CARD_SKUS).not.toContain("MEM-LEXAR-512GB-LSDMI512BB633A");
    expect(CAMERA_QUOTE_CARD_SKUS).not.toContain("MEM-IMOU-64GB");
    expect(CAMERA_QUOTE_DEFAULT_CARD_SKU).toBe("SP7F7D2202241D-A832AE");
  });
});
