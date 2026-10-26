import { and, asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AutoPrint } from "@/components/print/auto-print";
import { db } from "@/db";
import { products, profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { requireStockAccess } from "@/lib/actions/common";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";

export default async function PrintStocktakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const gate = await requireStockAccess();
  if (!gate.ok) notFound();
  const t = await getTranslations();
  const canViewValues = canViewPurchasePrices(gate.role);

  const [stocktake] = await db
    .select({
      id: stocktakes.id,
      code: stocktakes.code,
      status: stocktakes.status,
      note: stocktakes.note,
      createdAt: stocktakes.createdAt,
      balancedAt: stocktakes.balancedAt,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
    })
    .from(stocktakes)
    .innerJoin(warehouses, and(
      eq(stocktakes.warehouseId, warehouses.id),
      eq(warehouses.storeId, gate.storeId),
    ))
    .leftJoin(profiles, and(
      eq(stocktakes.createdBy, profiles.id),
      eq(profiles.storeId, gate.storeId),
    ))
    .where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id)))
    .limit(1);
  if (!stocktake) notFound();

  const items = await db
    .select({
      id: stocktakeItems.id,
      productName: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      systemQty: stocktakeItems.systemQty,
      actualQty: stocktakeItems.actualQty,
      costPrice: canViewValues ? products.costPrice : sql<string | null>`null`,
    })
    .from(stocktakeItems)
    .innerJoin(products, and(
      eq(stocktakeItems.productId, products.id),
      eq(products.storeId, gate.storeId),
    ))
    .where(and(
      eq(stocktakeItems.storeId, gate.storeId),
      eq(stocktakeItems.stocktakeId, id),
    ))
    .orderBy(asc(products.name), asc(products.sku));

  const summary = items.reduce((total, item) => {
    const diff = Number(item.actualQty) - Number(item.systemQty);
    total.totalDiff += diff;
    if (Math.abs(diff) > 1e-9) total.differentProducts += 1;
    if (canViewValues) {
      const value = diff * Number(item.costPrice ?? 0);
      if (value > 0) total.increaseValue += value;
      if (value < 0) total.decreaseValue += Math.abs(value);
      total.netValue += value;
    }
    return total;
  }, { totalDiff: 0, differentProducts: 0, increaseValue: 0, decreaseValue: 0, netValue: 0 });

  return (
    <>
      <AutoPrint closeHref={Routes.stocktakeDetail(id)} printTitle={stocktake.code} />
      <div className="print-document-root flex min-h-screen items-start justify-center overflow-auto py-8 print:py-0">
        <article className="print-document print-document--a4 w-[794px] bg-white p-10 text-[13px] text-slate-950 shadow-lg print:w-full print:max-w-none print:p-0 print:shadow-none">
          <header className="border-b border-slate-300 pb-5">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t("stocktakes.printTitle")}</div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-bold">{stocktake.code}</h1>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{t(`stocktakes.status.${stocktake.status}` as never)}</span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <PrintMeta label={t("inventory.warehouseLabel")} value={stocktake.warehouseName} />
              <PrintMeta label={t("internalUse.cols.by")} value={stocktake.byName ?? "—"} />
              <PrintMeta label={t("orders.cols.date")} value={formatDate(stocktake.createdAt)} />
              <PrintMeta label={t("stocktakes.cols.balancedAt")} value={stocktake.balancedAt ? formatDate(stocktake.balancedAt) : "—"} />
              <PrintMeta label={t("stocktakes.cols.items")} value={formatNumber(items.length)} />
              <PrintMeta label={t("stocktakes.cols.totalDiff")} value={`${summary.totalDiff > 0 ? "+" : ""}${formatNumber(summary.totalDiff)}`} />
            </dl>
          </header>

          <section className="mt-6">
            <h2 className="mb-3 text-base font-bold">{t("stocktakes.detail.linesTitle")}</h2>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{t("stocktakes.detail.emptyLines")}</p>
            ) : (
              <table className="w-full border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-y border-slate-300 bg-slate-100">
                    <th className="px-2 py-2.5">{t("orders.detail.items")}</th>
                    <th className="px-2 py-2.5">SKU</th>
                    <th className="px-2 py-2.5 text-right">{t("stocktakes.cols.systemQty")}</th>
                    <th className="px-2 py-2.5 text-right">{t("stocktakes.cols.actualQty")}</th>
                    <th className="px-2 py-2.5 text-right">{t("stocktakes.cols.diff")}</th>
                    {canViewValues && <th className="px-2 py-2.5 text-right">{t("stocktakes.cols.diffValue")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const diff = Number(item.actualQty) - Number(item.systemQty);
                    const value = diff * Number(item.costPrice ?? 0);
                    return (
                      <tr key={item.id} className="break-inside-avoid border-b border-slate-200">
                        <td className="px-2 py-2.5 font-semibold">{item.productName}</td>
                        <td className="px-2 py-2.5 font-mono text-xs">{item.sku}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{formatNumber(Number(item.systemQty))} {item.baseUnit}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{formatNumber(Number(item.actualQty))} {item.baseUnit}</td>
                        <td className={cn("whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums", diff > 0 ? "text-green-700" : diff < 0 ? "text-red-700" : "text-slate-500")}>{diff > 0 ? "+" : ""}{formatNumber(diff)} {item.baseUnit}</td>
                        {canViewValues && <td className={cn("whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums", value > 0 ? "text-green-700" : value < 0 ? "text-red-700" : "text-slate-500")}>{formatCurrency(value)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Summary label={t("stocktakes.summary.checked")} value={formatNumber(items.length)} />
            <Summary label={t("stocktakes.summary.diffProducts")} value={formatNumber(summary.differentProducts)} />
            {canViewValues && (
              <>
                <Summary label={t("stocktakes.summary.valueIncrease")} value={formatCurrency(summary.increaseValue)} />
                <Summary label={t("stocktakes.summary.valueDecrease")} value={formatCurrency(summary.decreaseValue)} />
                <Summary label={t("stocktakes.summary.netValue")} value={formatCurrency(summary.netValue)} />
              </>
            )}
          </section>
          {stocktake.note && <p className="mt-5 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm">{stocktake.note}</p>}
          {canViewValues && <p className="mt-3 text-xs text-slate-500">{t("stocktakes.detail.valueBasis")}</p>}
        </article>
      </div>
    </>
  );
}

function PrintMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-semibold">{value}</dd>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-300 px-3 py-2.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
