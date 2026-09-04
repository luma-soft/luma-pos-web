import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { promotions } from "@/db/schema";
import { isPromoActive, type PromoTier } from "@/lib/promo";

/** Authoritative active promotion projection shared by POS and catalog sync. */
export async function getActivePromotions(storeId: string): Promise<Record<string, PromoTier[]>> {
  const rows = await db.select({ productId: promotions.productId, tiers: promotions.tiers,
    isActive: promotions.isActive, startsAt: promotions.startsAt, endsAt: promotions.endsAt })
    .from(promotions).where(and(eq(promotions.storeId, storeId), eq(promotions.isActive, true)));
  return Object.fromEntries(rows.filter((row) => isPromoActive(row)).map((row) => [row.productId, row.tiers ?? []]));
}
