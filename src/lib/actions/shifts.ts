"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { getCurrentShift, shiftExpectedCash } from "@/lib/data/shifts";
import { type ActionResult, requireUser, getProfileId, generateCode, toMoney, isUniqueViolation } from "./common";
import { Routes } from "@/lib/routes";

export async function openShift(openingFloat: number): Promise<ActionResult<{ id: string; code: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
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
