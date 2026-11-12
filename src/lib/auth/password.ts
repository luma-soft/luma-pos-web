import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { compare as compareBcrypt, hash as hashBcrypt } from "bcryptjs";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derived) => error ? reject(error) : resolve(derived),
    );
  });
}

export function isValidNewPassword(password: string): boolean {
  const byteLength = Buffer.byteLength(password, "utf8");
  return password.length >= 8 && byteLength <= 1024;
}

export async function hashPassword(password: string) {
  if (!isValidNewPassword(password)) {
    throw new Error("PASSWORD_POLICY_FAILED");
  }

  const salt = randomBytes(16);
  const derived = await deriveScryptKey(password, salt);
  return {
    hash: [
      "v1",
      SCRYPT_N,
      SCRYPT_R,
      SCRYPT_P,
      salt.toString("base64url"),
      derived.toString("base64url"),
    ].join("$"),
    type: "scrypt" as const,
  };
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
  hashType: string,
): Promise<boolean> {
  try {
    if (hashType === "bcrypt") {
      return await compareBcrypt(password, encodedHash);
    }
    if (hashType !== "scrypt") return false;

    const [version, n, r, p, saltValue, hashValue, extra] = encodedHash.split("$");
    if (
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

    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await deriveScryptKey(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function createDummyBcryptHash(): Promise<string> {
  return hashBcrypt(randomBytes(32).toString("hex"), 10);
}
