import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const PIN_PATTERN = /^\d{4,8}$/;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const MIN_CONTEXT_SECRET_LENGTH = 32;

export type CashierContextRole = "owner" | "manager" | "cashier" | "warehouse";

export type CashierContextClaims = {
  principalId: string;
  cashierId: string;
  role: CashierContextRole;
  expiresAtMs: number;
};

export function isValidCashierPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function cashierContextSecret(): string {
  const secret = process.env.MOBILE_CASHIER_CONTEXT_SECRET ?? "";
  assertContextSecret(secret);
  return secret;
}

export function hashCashierPin(pin: string): string {
  if (!isValidCashierPin(pin)) {
    throw new Error("Cashier PIN must contain 4 to 8 digits");
  }
  const salt = randomBytes(16);
  const hash = derivePinKey(pin, salt);
  return [
    "scrypt",
    "v1",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyCashierPin(pin: string, encoded: string): boolean {
  if (!isValidCashierPin(pin)) return false;
  try {
    const [algorithm, version, n, r, p, saltValue, hashValue, extra] =
      encoded.split("$");
    if (
      algorithm !== "scrypt" ||
      version !== "v1" ||
      Number(n) !== SCRYPT_N ||
      Number(r) !== SCRYPT_R ||
      Number(p) !== SCRYPT_P ||
      !saltValue ||
      !hashValue ||
      extra !== undefined
    ) {
      return false;
    }
    const expected = Buffer.from(hashValue, "base64url");
    const actual = derivePinKey(pin, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createCashierContextToken(
  claims: Omit<CashierContextClaims, "expiresAtMs">,
  options: { secret: string; nowMs?: number; ttlMs?: number },
): string {
  assertContextSecret(options.secret);
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? 8 * 60 * 60 * 1000;
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      principalId: claims.principalId,
      cashierId: claims.cashierId,
      role: claims.role,
      expiresAtMs: nowMs + ttlMs,
      nonce: randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload, options.secret)}`;
}

export function verifyCashierContextToken(
  token: string,
  options: { secret: string; principalId: string; nowMs?: number },
): CashierContextClaims | null {
  try {
    assertContextSecret(options.secret);
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(signPayload(payload, options.secret), "base64url");
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null;
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: unknown;
      principalId?: unknown;
      cashierId?: unknown;
      role?: unknown;
      expiresAtMs?: unknown;
    };
    const role = value.role;
    const expiresAtMs = Number(value.expiresAtMs);
    if (
      value.v !== 1 ||
      value.principalId !== options.principalId ||
      typeof value.cashierId !== "string" ||
      !isCashierContextRole(role) ||
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= (options.nowMs ?? Date.now())
    ) {
      return null;
    }
    return {
      principalId: options.principalId,
      cashierId: value.cashierId,
      role,
      expiresAtMs,
    };
  } catch {
    return null;
  }
}

function derivePinKey(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function assertContextSecret(secret: string): void {
  if (secret.length < MIN_CONTEXT_SECRET_LENGTH) {
    throw new Error("MOBILE_CASHIER_CONTEXT_SECRET must contain at least 32 characters");
  }
}

function isCashierContextRole(value: unknown): value is CashierContextRole {
  return value === "owner" ||
    value === "manager" ||
    value === "cashier" ||
    value === "warehouse";
}
