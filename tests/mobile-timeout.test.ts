import { describe, expect, test } from "bun:test";
import { withTimeout } from "@/lib/mobile/timeout";

describe("mobile data timeout", () => {
  test("rejects instead of returning a fallback value", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 5)).rejects.toThrow("mobile.dataTimeout");
  });

  test("preserves the original data error", async () => {
    await expect(withTimeout(Promise.reject(new Error("database unavailable")), 50)).rejects.toThrow(
      "database unavailable",
    );
  });
});
