"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, shifts } from "@/db/schema";
import { getCurrentShift, shiftExpectedCash } from "@/lib/data/shifts";
import { type ActionResult, requireUser, getProfileId, generateCode, toMoney, isUniqueViolation } from "./common";
import { Routes } from "@/lib/routes";

export async function openShift(openingFloat: number): Promise<ActionResult<{ id: string; code: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  return openShiftForUser(userId, openingFloat);
}

export async function openShiftForUser(userId: string, openingFloat: number): Promise<ActionResult<{ id: string; code: string }>> {
  if (!(openingFloat >= 0)) return { ok: false, error: "errors.invalidData" };
  try {
    const profileId = await getProfileId(userId);
    if (!profileId) return { ok: false, error: "errors.invalidData" };
    const existing = await getCurrentShift(profileId);
    if (existing) return { ok: false, error: "shifts.errors.alreadyOpen" };
    const [row] = await db.insert(shifts).values({
      code: generateCode("CA"),
      userId: profileId,
      openingFloat: toMoney(openingFloat),
      status: "open",
    }).returning({ id: shifts.id, code: shifts.code });
    revalidatePath(Routes.Finance);
    return { ok: true, data: row };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "shifts.errors.alreadyOpen" };
    console.error("openShift failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function closeShift(countedCash: number, note?: string): Promise<ActionResult<{ variance: number }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  return closeShiftForUser(userId, countedCash, note);
}

export async function closeShiftForUser(userId: string, countedCash: number, note?: string): Promise<ActionResult<{ variance: number }>> {
  if (!(countedCash >= 0)) return { ok: false, error: "errors.invalidData" };
  try {
    const profileId = await getProfileId(userId);
    if (!profileId) return { ok: false, error: "errors.invalidData" };
    const shift = await getCurrentShift(profileId);
    if (!shift) return { ok: false, error: "shifts.errors.noOpen" };
    const expected = await shiftExpectedCash(Number(shift.openingFloat), shift.id);
    const variance = countedCash - expected;
    await db.update(shifts).set({
      status: "closed",
      closedAt: new Date(),
      expectedCash: toMoney(expected),
      countedCash: toMoney(countedCash),
      variance: toMoney(variance),
      note: note || null,
    }).where(and(eq(shifts.id, shift.id), eq(shifts.status, "open")));
    revalidatePath(Routes.Finance);
    return { ok: true, data: { variance } };
  } catch (e) {
    console.error("closeShift failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function handoverShiftForUser(input: {
  userId: string;
  targetProfileId: string;
  countedCash: number;
  note?: string;
}): Promise<ActionResult<{ closedShiftId: string; openedShiftId: string; variance: number }>> {
  if (!(input.countedCash >= 0) || !input.targetProfileId) {
    return { ok: false, error: "errors.invalidData" };
  }
  try {
    const profileId = await getProfileId(input.userId);
    if (!profileId || profileId === input.targetProfileId) {
      return { ok: false, error: "errors.invalidData" };
    }
    const [shift, target, targetShift] = await Promise.all([
      getCurrentShift(profileId),
      db.select().from(profiles).where(eq(profiles.id, input.targetProfileId)).limit(1),
      getCurrentShift(input.targetProfileId),
    ]);
    if (!shift) return { ok: false, error: "shifts.errors.noOpen" };
    if (!target[0]?.isActive || !["owner", "manager", "cashier"].includes(target[0].role)) {
      return { ok: false, error: "shifts.errors.invalidHandoverTarget" };
    }
    if (targetShift) return { ok: false, error: "shifts.errors.targetAlreadyOpen" };

    const expected = await shiftExpectedCash(Number(shift.openingFloat), shift.id);
    const variance = input.countedCash - expected;
    const opened = await db.transaction(async (tx) => {
      const [closed] = await tx.update(shifts).set({
        status: "closed",
        closedAt: new Date(),
        expectedCash: toMoney(expected),
        countedCash: toMoney(input.countedCash),
        variance: toMoney(variance),
        note: input.note?.trim() || null,
        handoverToUserId: input.targetProfileId,
      }).where(and(eq(shifts.id, shift.id), eq(shifts.status, "open")))
        .returning({ id: shifts.id });
      if (!closed) throw new Error("SHIFT_ALREADY_CLOSED");
      const [next] = await tx.insert(shifts).values({
        code: generateCode("CA"),
        userId: input.targetProfileId,
        openingFloat: toMoney(input.countedCash),
        status: "open",
        handoverFromShiftId: shift.id,
        note: input.note?.trim() || null,
      }).returning({ id: shifts.id });
      return next;
    });
    revalidatePath(Routes.Finance);
    return {
      ok: true,
      data: {
        closedShiftId: shift.id,
        openedShiftId: opened.id,
        variance,
      },
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "shifts.errors.targetAlreadyOpen" };
    }
    if (e instanceof Error && e.message === "SHIFT_ALREADY_CLOSED") {
      return { ok: false, error: "shifts.errors.noOpen" };
    }
    console.error("handoverShift failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
