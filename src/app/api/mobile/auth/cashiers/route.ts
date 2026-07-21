import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const rows = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      pinConfigured: isNotNull(profiles.cashierPinHash),
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.isActive, true),
        inArray(profiles.role, ["owner", "manager", "cashier"]),
      ),
    )
    .orderBy(asc(profiles.fullName));

  return mobileOk(rows);
}
