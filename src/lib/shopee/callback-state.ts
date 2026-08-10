import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 15 * 60;

export function createShopeeCallbackState(storeId: string, partnerKey: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ storeId, issuedAt: Math.floor(now / 1000) })).toString("base64url");
  const signature = createHmac("sha256", partnerKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readShopeeCallbackState(state: string, partnerKey: string, now = Date.now()) {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", partnerKey).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { storeId?: unknown; issuedAt?: unknown };
    const issuedAt = Number(parsed.issuedAt);
    if (typeof parsed.storeId !== "string" || !Number.isSafeInteger(issuedAt)) return null;
    const age = Math.floor(now / 1000) - issuedAt;
    return age >= 0 && age <= MAX_AGE_SECONDS ? { storeId: parsed.storeId } : null;
  } catch {
    return null;
  }
}

export function peekShopeeCallbackStoreId(state: string) {
  const [payload] = state.split(".");
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { storeId?: unknown };
    return typeof parsed.storeId === "string" && /^[0-9a-f-]{36}$/i.test(parsed.storeId)
      ? parsed.storeId
      : null;
  } catch {
    return null;
  }
}
