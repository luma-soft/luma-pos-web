import { expect, test } from "bun:test";
import { publicRequestOrigin } from "./public-origin";

test("uses the tunnel's public host instead of the bound loopback address", () => {
  const request = new Request("https://localhost:3200/api/payments/sepay", {
    headers: { host: "pos.haidangshop.com", "x-forwarded-proto": "https" },
  });
  expect(publicRequestOrigin(request)).toBe("https://pos.haidangshop.com");
});

test("prefers x-forwarded-host and its first value", () => {
  const request = new Request("http://127.0.0.1:3000/x", {
    headers: { host: "127.0.0.1:3000", "x-forwarded-host": "pos.example.com, proxy.internal", "x-forwarded-proto": "https,http" },
  });
  expect(publicRequestOrigin(request)).toBe("https://pos.example.com");
});

test("keeps a direct loopback request as-is", () => {
  const request = new Request("http://127.0.0.1:3000/x", { headers: { host: "127.0.0.1:3000" } });
  expect(publicRequestOrigin(request)).toBe("http://127.0.0.1:3000");
});

test("falls back to request.url for a malformed host header", () => {
  const request = new Request("https://pos.example.com/x", { headers: { "x-forwarded-host": "evil.com/path" } });
  expect(publicRequestOrigin(request)).toBe("https://pos.example.com");
});
