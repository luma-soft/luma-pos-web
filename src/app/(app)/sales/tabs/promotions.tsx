import { getTranslations } from "next-intl/server";
import { and, desc, eq } from "drizzle-orm";
import { Percent } from "lucide-react";
import { db } from "@/db";
import { products, promotions } from "@/db/schema";
import { PromoQuickCreate } from "../../promotions/promo-widgets";
import { PromotionsTable } from "./promotions-table";
import { requireStoreContext } from "@/lib/auth/store-context";

export async function PromotionsTab() {
  const [t, context] = await Promise.all([getTranslations(), requireStoreContext()]);

  const rows = await db.select({
    id: promotions.id, name: promotions.name, tiers: promotions.tiers, isActive: promotions.isActive,
    startsAt: promotions.startsAt, endsAt: promotions.endsAt, productName: products.name, baseUnit: products.baseUnit,
  }).from(promotions).innerJoin(products, and(eq(promotions.productId, products.id), eq(products.storeId, context.storeId))).where(eq(promotions.storeId, context.storeId)).orderBy(desc(promotions.createdAt));

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="text-sm text-slate-500">{t("promos.total", { total: rows.length })}</span>
        <PromoQuickCreate />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Percent className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("promos.empty")}</p>
          <p className="text-sm mt-1">{t("promos.emptyHint")}</p>
        </div>
      ) : (
        <PromotionsTable rows={rows} />
      )}
      <p className="text-xs text-slate-400 mt-3">{t("promos.posHint")}</p>
    </>
  );
}
