import { createHash, randomBytes } from "node:crypto";

export function createCustomerRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCustomerRequestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isCustomerRequestTokenUsable(input: {
  status: string;
  expiresAt: Date;
  now?: Date;
}) {
  return input.status === "new"
    && input.expiresAt.getTime() > (input.now ?? new Date()).getTime();
}
