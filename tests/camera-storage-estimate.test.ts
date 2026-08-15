import { describe, expect, test } from "bun:test";
import { estimateStorageDays } from "../src/lib/camera-storage-estimate";

describe("camera storage estimate", () => {
  test("uses field-realistic 64GB retention ranges", () => {
    expect(estimateStorageDays(64, 2)).toBe("~6–8 ngày");
    expect(estimateStorageDays(64, 3)).toBe("~3–5 ngày");
    expect(estimateStorageDays(64, 4)).toBe("~2–3 ngày");
    expect(estimateStorageDays(64, 5)).toBe("~2–3 ngày");
    expect(estimateStorageDays(64, 6)).toBe("~1–2 ngày");
  });

  test("scales the estimate with card capacity", () => {
    expect(estimateStorageDays(32, 2)).toBe("~3–4 ngày");
    expect(estimateStorageDays(128, 2)).toBe("~12–16 ngày");
  });

  test("asks for advice when capacity is unavailable", () => {
    expect(estimateStorageDays(null, 2)).toBe("Liên hệ để tư vấn");
  });
});
