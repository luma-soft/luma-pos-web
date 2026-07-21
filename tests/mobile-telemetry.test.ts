import { describe, expect, it } from "vitest";
import { mobileTelemetrySchema } from "@/lib/telemetry/mobile";

describe("privacy-safe mobile telemetry", () => {
  it("accepts aggregate sync telemetry", () => {
    expect(mobileTelemetrySchema.safeParse({
      eventType: "sync_result",
      platform: "android",
      appVersion: "1.0.0+1",
      durationMs: 1250,
      attemptedCount: 4,
      succeededCount: 3,
      failedCount: 1,
      conflictCount: 0,
    }).success).toBe(true);
  });

  it("rejects arbitrary fields that could contain PII", () => {
    expect(mobileTelemetrySchema.safeParse({
      eventType: "app_error",
      platform: "ios",
      appVersion: "1.0.0+1",
      errorType: "StateError",
      fingerprint: "0123456789abcdef",
      message: "customer phone 0900000000",
      stack: "raw stack",
    }).success).toBe(false);
  });
});
