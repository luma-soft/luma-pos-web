import { getTranslations } from "next-intl/server";
import { asc, desc, eq } from "drizzle-orm";
import { Percent } from "lucide-react";
import { db } from "@/db";
import { products, promotions } from "@/db/schema";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { isPromoActive } from "@/lib/promo";
import { PromoQuickCreate, PromoToggle } from "./promo-widgets";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  const t = await getTranslations();

  const [rows, productOptions] = await Promise.all([
    db
      .select({
        id: promotions.id,
        name: promotions.name,
        tiers: promotions.tiers,
        isActive: promotions.isActive,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
        productName: products.name,
        baseUnit: products.baseUnit,
      })
      .from(promotions)
      .innerJoin(products, eq(promotions.productId, products.id))
      .orderBy(desc(promotions.createdAt)),
    db.select({ id: products.id, name: products.name, sku: products.sku, baseUnit: products.baseUnit })
      .from(products).where(eq(products.isActive, true)).orderBy(asc(products.name)).limit(500),
  ]);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("promos.title")}</h1>
          <span className="text-sm text-slate-500">{t("promos.total", { total: rows.length })}</span>
        </div>
        <PromoQuickCreate products={productOptions} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Percent className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("promos.empty")}</p>
          <p className="text-sm mt-1">{t("promos.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((p) => {
            const active = isPromoActive(p);
            return (
              <div key={p.id} className={cn("bg-surface border border-border rounded-card p-3", !active && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-slate-400 truncate">{p.productName}</div></div>
                  <PromoToggle id={p.id} isActive={p.isActive} />
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(p.tiers ?? []).map((tier, i) => (
                    <span key={i} className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-400">
                      ≥{formatNumber(tier.minQty)} → −{tier.discountPct}%
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("promos.cols.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.product")}</th>
                <th className="px-4 py-3 font-semibold">{t("promos.cols.tiers")}</th>
                <th className="px-4 py-3 font-semibold">{t("promos.cols.period")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((p) => {
                const active = isPromoActive(p);
                return (
                  <tr key={p.id} className={cn("hover:bg-surface-2", !active && "opacity-60")}>
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3">{p.productName}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(p.tiers ?? []).map((tier, i) => (
                          <span key={i} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-400">
                            ≥{formatNumber(tier.minQty)} {p.baseUnit} → −{tier.discountPct}%
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {p.startsAt ? formatDate(p.startsAt).split(" ")[1] ?? formatDate(p.startsAt) : "—"} → {p.endsAt ? formatDate(p.endsAt) : t("promos.noEnd")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        active ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500"
                      )}>
                        {active ? t("promos.active") : t("promos.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right"><PromoToggle id={p.id} isActive={p.isActive} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="text-xs text-slate-400 mt-3">{t("promos.posHint")}</p>
    </div>
  );
}
