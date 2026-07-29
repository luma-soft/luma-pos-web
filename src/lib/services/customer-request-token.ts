import { createHash, randomBytes } from "node:crypto";

export function createCustomerRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCustomerRequestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isCustomerRequestTokenSubmittable(input: {
  status: string;
  submittedAt: Date | null;
  expiresAt: Date;
  now?: Date;
}) {
  return input.status === "new"
    && input.submittedAt === null
    && input.expiresAt.getTime() > (input.now ?? new Date()).getTime();
}

export function isCustomerRequestTokenViewable(input: {
  expiresAt: Date;
  now?: Date;
}) {
  return input.expiresAt.getTime() > (input.now ?? new Date()).getTime();
}

/** @deprecated Use the explicit submit/view eligibility helpers. */
export function isCustomerRequestTokenUsable(input: {
  status: string;
  expiresAt: Date;
  now?: Date;
}) {
  return isCustomerRequestTokenSubmittable({
    ...input,
    submittedAt: input.status === "new" ? null : new Date(0),
  });
}
