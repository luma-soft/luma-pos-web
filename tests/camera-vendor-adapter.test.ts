import { describe, expect, test } from "bun:test";
import {
  createCameraVendorAdapter,
  EzvizReadOnlyAdapter,
} from "../src/lib/camera-vendors/adapter";

describe("camera vendor adapter", () => {
  test("defaults to a disabled adapter without making vendor calls", async () => {
    const adapter = createCameraVendorAdapter({ enabled: false });
    expect(adapter.vendor).toBe("disabled");
    await expect(adapter.getDeviceHealth("camera-1")).rejects.toThrow("CAMERA_VENDOR_DISABLED");
    expect(adapter.buildVendorAppLink("camera-1")).toBeNull();
  });

  test("EZVIZ remains disabled until verified endpoint templates are configured", async () => {
    const adapter = createCameraVendorAdapter({
      enabled: true,
      vendor: "ezviz",
      accessToken: "server-secret",
    });
    await expect(adapter.getDeviceSummary("camera-1")).rejects.toThrow(
      "CAMERA_VENDOR_NOT_CONFIGURED",
    );
  });

  test("normalizes a configured read-only health response", async () => {
    const calls: string[] = [];
    const adapter = new EzvizReadOnlyAdapter({
      accessToken: "server-secret",
      healthUrlTemplate: "https://partner.example/devices/{deviceId}/health",
      appUrlTemplate: "ezviz://device/{deviceId}",
      fetcher: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({
          online: true,
          status: "healthy",
          lastSeenAt: "2026-07-29T01:00:00.000Z",
          firmwareVersion: "1.2.3",
          storageStatus: "ok",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    expect(await adapter.getDeviceHealth("CAM 01")).toEqual({
      online: true,
      status: "healthy",
      lastSeenAt: "2026-07-29T01:00:00.000Z",
      firmwareVersion: "1.2.3",
      storageStatus: "ok",
    });
    expect(calls).toEqual(["https://partner.example/devices/CAM%2001/health"]);
    expect(adapter.buildVendorAppLink("CAM 01")).toBe("ezviz://device/CAM%2001");
  });
});
