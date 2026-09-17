import { describe, expect, test } from "bun:test";

import {
  readBearerToken,
  readRefreshToken,
  resolveMobileWebSessionTarget,
} from "./web-session.ts";

describe("mobile web session bridge", () => {
  test("allows only the supported price-list destinations", () => {
    expect(resolveMobileWebSessionTarget("/camera-price-list")).toBe(
      "/camera-price-list",
    );
    expect(resolveMobileWebSessionTarget("/hunonic-price-list")).toBe(
      "/hunonic-price-list",
    );
    expect(resolveMobileWebSessionTarget("/rang-dong-smart-price-list")).toBe(
      "/rang-dong-smart-price-list",
    );
    expect(resolveMobileWebSessionTarget("https://evil.example")).toBeNull();
    expect(resolveMobileWebSessionTarget("/dashboard")).toBeNull();
  });

  test("reads tokens from headers without accepting malformed bearer values", () => {
    const request = new Request("https://luma.example/api/mobile/auth/web-session", {
      headers: {
        Authorization: "Bearer access-token",
        "X-Luma-Refresh-Token": "refresh-token",
      },
    });

    expect(readBearerToken(request)).toBe("access-token");
    expect(readRefreshToken(request)).toBe("refresh-token");
    expect(
      readBearerToken(
        new Request(request.url, { headers: { Authorization: "access-token" } }),
      ),
    ).toBeNull();
  });
});
