import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CameraVaultPayload } from "@/lib/services/project-specialized-schemas";

export type EncryptedCameraVault = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function cameraVaultKey(envValue = process.env.SERVICE_VAULT_ENCRYPTION_KEY): Buffer {
  const value = envValue?.trim();
  if (!value) throw new Error("SERVICE_VAULT_ENCRYPTION_KEY_REQUIRED");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("SERVICE_VAULT_ENCRYPTION_KEY_INVALID");
  return key;
}

function vaultAad(storeId: string, assetId: string): Buffer {
  return Buffer.from(`luma:camera-vault:v1:${storeId}:${assetId}`, "utf8");
}

export function encryptCameraVault(
  payload: CameraVaultPayload,
  context: { storeId: string; assetId: string; keyVersion?: number },
  envValue?: string,
): EncryptedCameraVault {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cameraVaultKey(envValue), iv);
  cipher.setAAD(vaultAad(context.storeId, context.assetId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: context.keyVersion ?? 1,
  };
}

export function decryptCameraVault(
  encrypted: EncryptedCameraVault,
  context: { storeId: string; assetId: string },
  envValue?: string,
): CameraVaultPayload {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    cameraVaultKey(envValue),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAAD(vaultAad(context.storeId, context.assetId));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as CameraVaultPayload;
}

export function cameraVaultMaskedSummary(payload: CameraVaultPayload) {
  return {
    configured: Object.values(payload).some((value) => value !== "" && value !== null),
    hasUsername: Boolean(payload.username),
    hasPassword: Boolean(payload.password),
    hasVerificationCode: Boolean(payload.verificationCode),
    hasEncryptionKey: Boolean(payload.encryptionKey),
    ddnsProvider: payload.ddnsProvider || null,
    ddnsDomain: payload.ddnsDomain || null,
    wanIp: payload.wanIp || null,
    httpPort: payload.httpPort,
    rtspPort: payload.rtspPort,
    onvifPort: payload.onvifPort,
    directUrl: payload.directUrl || null,
  };
}
