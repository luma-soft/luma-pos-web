import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import {
  isValidCashierPin,
  verifyCashierPin,
} from "@/lib/auth/cashier-pin";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_DURATION_MS = 15 * 60 * 1000;

type VerifiedStaff = {
  id: string;
  fullName: string;
  role: Role;
};

export type StaffPinVerification =
  | { ok: true; staff: VerifiedStaff }
  | {
      ok: false;
      error:
        | "errors.invalidData"
        | "errors.unauthorized"
        | "errors.cashierPinNotConfigured"
        | "errors.tooManyAttempts";
      status: number;
      staff?: VerifiedStaff;
      failedAttempts?: number;
    };

export async function verifyStaffPin(
  staffId: string,
  pin: string,
): Promise<StaffPinVerification> {
  if (!staffId || !isValidCashierPin(pin)) {
    return { ok: false, error: "errors.invalidData", status: 400 };
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        isActive: profiles.isActive,
        pinHash: profiles.cashierPinHash,
        failedAttempts: profiles.cashierPinFailedAttempts,
        lockedUntil: profiles.cashierPinLockedUntil,
      })
      .from(profiles)
      .where(eq(profiles.id, staffId))
      .limit(1)
      .for("update");

    if (!row?.isActive) {
      return { ok: false, error: "errors.unauthorized", status: 401 };
    }
    const staff: VerifiedStaff = {
      id: row.id,
      fullName: row.fullName,
      role: row.role,
    };
    if (!row.pinHash) {
      return {
        ok: false,
        error: "errors.cashierPinNotConfigured",
        status: 409,
        staff,
      };
    }

    const now = new Date();
    if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      return {
        ok: false,
        error: "errors.tooManyAttempts",
        status: 429,
        staff,
      };
    }

    if (!verifyCashierPin(pin, row.pinHash)) {
      const previousAttempts = row.lockedUntil ? 0 : row.failedAttempts;
      const failedAttempts = previousAttempts + 1;
      const lockedUntil = failedAttempts >= MAX_PIN_ATTEMPTS
        ? new Date(now.getTime() + PIN_LOCK_DURATION_MS)
        : null;
      await tx
        .update(profiles)
        .set({
          cashierPinFailedAttempts: failedAttempts,
          cashierPinLockedUntil: lockedUntil,
        })
        .where(eq(profiles.id, row.id));
      return {
        ok: false,
        error: lockedUntil ? "errors.tooManyAttempts" : "errors.unauthorized",
        status: lockedUntil ? 429 : 401,
        staff,
        failedAttempts,
      };
    }

    await tx
      .update(profiles)
      .set({ cashierPinFailedAttempts: 0, cashierPinLockedUntil: null })
      .where(eq(profiles.id, row.id));
    return { ok: true, staff };
  });
}
