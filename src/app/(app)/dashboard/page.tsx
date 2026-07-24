import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getDashboard, categoryEmoji, type DashboardRange } from "@/lib/data/dashboard";
import { OrderStatusBadge, PaymentStatusBadge } from "../orders/status-badges";
import { buttonVariants } from "@/components/ui/button-variants";
import { Text } from "@/components/ui/text";

export const dynamic = "force-dynamic";

const RANGES: DashboardRange[] = ["today", "7d", "30d", "month"];
const DOW_LABEL = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const range = (RANGES.includes(params.range as DashboardRange) ? params.range : "7d") as DashboardRange;
  const data = await getDashboard(range);

  const maxDay = Math.max(1, ...data.revenueByDay.map((d) => Number(d.revenue)));

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* header — theo design: title + Realtime + range seg + nút bán hàng */}
      <div className="flex items-center gap-3 flex-wrap">
        <Text as="h1" size="2xl" weight="bold" className="min-w-0 flex-1 sm:flex-none" text={t("dashboard.title")} />
        <Text
          as="span"
          size="xs"
          weight="medium"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 bg-ok-soft text-ok"
          text={`● ${t("dashboard.realtime")}`}
        />
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-3 flex-wrap">
          <div className="inline-flex w-full sm:w-auto bg-surface-2 rounded-lg p-0.5 gap-0.5 overflow-x-auto">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`${Routes.Dashboard}?range=${r}`}
                className={cn(
                  "flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-semibold text-center whitespace-nowrap",
                  range === r
                    ? "bg-surface text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500"
                )}
              >
                {t(`dashboard.range.${r}`)}
              </Link>
            ))}
          </div>
          <Link href={Routes.POS} className={cn(buttonVariants({ block: true }), "sm:w-auto gap-2")}>
            + {t("nav.pos")}
            <Text as="span" className="text-[10px] font-mono bg-white/20 rounded px-1.5 py-0.5 text-current" text="F2" />
          </Link>
        </div>
      </div>

      {/* 4 stat cards — theo design */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface rounded-card border border-border p-5">
          <div className="text-xs font-semibold text-slate-500">{t(`dashboard.revenueLabel.${range}`)}</div>
          <div className="text-[22px] font-extrabold tabular-nums mt-1.5">{formatCurrency(data.revenue)}</div>
          <div className="text-xs text-ok mt-1">{t("dashboard.ordersCount", { count: data.orderCount })}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.grossProfit")}</div>
          <div className="text-[22px] font-extrabold tabular-nums mt-1.5">{formatCurrency(data.grossProfit)}</div>
          <div className="text-xs text-ok mt-1">{t("dashboard.marginPct", { pct: data.marginPct.toFixed(1) })}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.ordersLabel")}</div>
          <div className="text-[22px] font-extrabold tabular-nums mt-1.5">{data.orderCount}</div>
          <div className="text-xs text-slate-400 mt-1">{data.orderCount > 0 ? t("dashboard.avgPerOrder", { avg: formatCurrency(Math.round(data.avgOrder)) }) : "—"}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.receivable")}</div>
          <div className="text-[22px] font-extrabold tabular-nums mt-1.5 text-warn">{formatCurrency(data.debt.total)}</div>
          <div className={cn("text-xs mt-1", data.debt.debtors > 0 ? "text-er" : "text-slate-400")}>
            {t("dashboard.debtors", { count: data.debt.debtors })}
          </div>
        </div>
      </div>

      {/* chart + low stock — theo design 1.6fr/1fr */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <div className="bg-surface rounded-card border border-border">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <Text as="h2" weight="bold" text={t("dashboard.revenueByDay")} />
            <Text as="span" variant="muted" size="xs" text={t("dashboard.unitMillion")} />
          </div>
          <div className="p-5">
            {data.revenueByDay.length === 0 ? (
              <Text as="p" variant="muted" className="py-12 text-center" text={t("dashboard.noData")} />
            ) : (
              <div className="flex items-end gap-2.5 h-44">
                {data.revenueByDay.map((d) => {
                  const v = Number(d.revenue);
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5" title={`${d.day}: ${formatCurrency(v)}`}>
                      <div
                        className={cn("w-full rounded-t-md", d.dow === 7 ? "bg-surface-2" : "bg-primary-600/90")}
                        style={{ height: `${Math.max(4, (v / maxDay) * 100)}%` }}
                      />
                      <Text as="span" variant="muted" className="text-[10px] text-center leading-tight">
                        {DOW_LABEL[d.dow]}<br />{(v / 1e6).toFixed(1).replace(".", ",")}
                      </Text>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* cảnh báo tồn kho — theo design: thumb emoji + badge */}
        <div className="bg-surface rounded-card border border-border">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <Text as="h2" weight="bold" text={t("dashboard.lowStockTitle")} />
            <Link href={`${Routes.Inventory}?low=1`} className="text-xs font-medium text-primary-600 hover:underline">{t("dashboard.viewAll")}</Link>
          </div>
          <div className="p-4">
            {data.lowStock.length === 0 ? (
              <Text as="p" variant="muted" className="py-10 text-center" text={t("dashboard.stockOk")} />
            ) : (
              <div className="divide-y divide-border-soft">
                {data.lowStock.map((p) => {
                  const stock = Number(p.totalStock);
                  const min = Number(p.minLevel);
                  const critical = stock <= min / 2;
                  return (
                    <div key={p.id} className="py-2.5 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-surface-2 grid place-items-center text-lg shrink-0">
                        {categoryEmoji(p.categoryName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px] truncate">{p.name}</div>
                        <div className="text-xs text-slate-400">
                          {t("dashboard.stockOfMin", { stock: formatNumber(stock), unit: p.baseUnit, min: formatNumber(min) })}
                        </div>
                      </div>
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0",
                        critical
                          ? "bg-er-soft text-er"
                          : "bg-warn-soft text-warn"
                      )}>
                        ● {critical ? t("dashboard.badgeCritical") : t("dashboard.badgeLow")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <Link
              href={Routes.PurchaseNew}
              className={cn(buttonVariants({ variant: "secondary", block: true }), "mt-3")}
            >
              {t("dashboard.createPurchase")}
            </Link>
          </div>
        </div>
      </div>

      {/* recent orders + debtors — theo design */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <div className="bg-surface rounded-card border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <Text as="h2" weight="bold" text={t("dashboard.recentOrders")} />
            <Link href={Routes.Orders} className="text-xs font-medium text-primary-600 hover:underline">{t("dashboard.allOrders")}</Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <Text as="p" variant="muted" className="py-10 text-center" text={t("orders.empty")} />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.code")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.customer")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.project")}</th>
                  <th className="px-4 py-2.5 font-bold text-right">{t("orders.cols.total")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.payment")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.recentOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={Routes.order(o.id)} className="font-semibold text-primary-600 hover:underline">
                        {o.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {o.customerName ?? t("orders.walkIn")}
                      {o.customerType && o.customerType !== "retail" && (
                        <Text as="span" variant="muted" size="xs" text={` (${t(`customers.types.${o.customerType}` as never)})`} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{o.projectName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(o.total))}</td>
                    <td className="px-4 py-3"><PaymentStatusBadge status={o.paymentStatus} /></td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="bg-surface rounded-card border border-border">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <Text as="h2" weight="bold" text={t("dashboard.topDebtors")} />
            <Link href={`${Routes.Customers}?owing=1`} className="text-xs font-medium text-primary-600 hover:underline">{t("dashboard.debtLink")}</Link>
          </div>
          <div className="p-4">
            {data.topDebtors.length === 0 ? (
              <Text as="p" variant="muted" className="py-10 text-center" text={t("dashboard.noDebt")} />
            ) : (
              <>
                <div className="divide-y divide-border-soft">
                  {data.topDebtors.map((c) => {
                    const initials = c.name.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase();
                    const debt = Number(c.currentDebt);
                    const limit = Number(c.debtLimit ?? 0);
                    const pct = limit > 0 ? Math.round((debt / limit) * 100) : null;
                    return (
                      <div key={c.id} className="py-2.5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-400 grid place-items-center text-[11px] font-bold shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={Routes.customer(c.id)} className="font-semibold text-[13px] hover:underline truncate block">{c.name}</Link>
                          <div className={cn("text-xs", pct != null && pct > 85 ? "text-er" : "text-slate-400")}>
                            {pct != null ? t("dashboard.pctOfLimit", { pct }) : t("dashboard.noLimit")}
                          </div>
                        </div>
                        <b className="text-[13px] tabular-nums text-er shrink-0">{formatCurrency(debt)}</b>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border mt-2 pt-3 flex justify-between text-sm">
                  <Text as="span" variant="muted" text={t("dashboard.totalReceivable")} />
                  <b className="tabular-nums">{formatCurrency(data.debt.total)}</b>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <Text as="span" className="hidden" text={formatDate(new Date())} />
    </div>
  );
}
