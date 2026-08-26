import { describe, expect, test } from "bun:test";
import {
  decryptCameraVault,
  encryptCameraVault,
  cameraVaultMaskedSummary,
} from "../src/lib/services/camera-vault";

const key = Buffer.alloc(32, 7).toString("base64");
const context = {
  storeId: "00000000-0000-4000-8000-000000000001",
  assetId: "11111111-1111-4111-8111-111111111111",
};
const payload = {
  username: "admin",
  password: "secret-password",
  verificationCode: "ABCDEF",
  encryptionKey: "device-key",
  ddnsProvider: "No-IP",
  ddnsDomain: "site.example.net",
  ddnsUsername: "ddns-user",
  ddnsPassword: "ddns-secret",
  wanIp: "203.0.113.10",
  httpPort: 80,
  rtspPort: 554,
  onvifPort: 8000,
  directUrl: "https://site.example.net",
};

describe("camera credential vault", () => {
  test("round-trips with AES-GCM without exposing plaintext in persisted fields", () => {
    const encrypted = encryptCameraVault(payload, context, key);

    expect(encrypted.ciphertext).not.toContain(payload.password);
    expect(encrypted.ciphertext).not.toContain(payload.verificationCode);
    expect(decryptCameraVault(encrypted, context, key)).toEqual(payload);
  });

  test("binds ciphertext to the tenant and asset through authenticated data", () => {
    const encrypted = encryptCameraVault(payload, context, key);

    expect(() => decryptCameraVault(encrypted, {
      ...context,
      assetId: "22222222-2222-4222-8222-222222222222",
    }, key)).toThrow();
  });

  test("returns only a redacted connectivity summary", () => {
    const summary = cameraVaultMaskedSummary(payload);

    expect(summary.hasPassword).toBe(true);
    expect(summary.hasVerificationCode).toBe(true);
    expect(summary.ddnsDomain).toBe("site.example.net");
    expect(summary).not.toHaveProperty("password");
    expect(summary).not.toHaveProperty("verificationCode");
  });
});
