
import { productDisplayName } from "@/lib/products/variant-presentation";
import Link from "next/link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { getLocale, getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getDashboard, categoryEmoji, type DashboardRange } from "@/lib/data/dashboard";
import { resolveDashboardRange } from "@/lib/dashboard/range";
import { MobileDashboardOfflineNotice } from "@/components/mobile-dashboard-offline-notice";
import { OrderStatusBadge, PaymentStatusBadge } from "../orders/status-badges";
import { buttonVariants } from "@/components/ui/button-variants";
import { Text } from "@/components/ui/text";
import { OrderDetailLink } from "@/components/order-detail-link";
import { BarChart3, Bell, FileText, ListChecks, Package, ScanLine, ShoppingCart, Users } from "lucide-react";
import { MobileCardHeader, MobileMetricTile, MobileQuickActionGrid, MobileSegmentedLinks, MobileTopBar } from "@/components/mobile-ui";
import { MobileProfitMetricTile } from "@/components/mobile-profit-metric-tile";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

const RANGES: DashboardRange[] = ["today", "7d", "30d", "month"]; // Desktop preserved
const MOBILE_RANGES: DashboardRange[] = ["today", "week", "month", "year"];
const DOW_LABEL = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

type DashboardDebtRow = {
  id: string;
  name: string;
  currentDebt: string | number;
  detail: string | null;
  detailTone?: "danger" | "muted";
};

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const context = await requireStoreContext();
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const params = await searchParams;
  const range = resolveDashboardRange(params.range);
  const data = await getDashboard(context.storeId, range);
  const maxDay = Math.max(1, ...data.revenueByDay.map((d) => Number(d.revenue)));
  const marginFormatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const debtorRows: DashboardDebtRow[] = data.topDebtors.map((customer) => {
    const debt = Number(customer.currentDebt);
    const limit = Number(customer.debtLimit ?? 0);
    const percentage = limit > 0 ? Math.round((debt / limit) * 100) : null;
    return {
      ...customer,
      detail: percentage != null
        ? t("dashboard.pctOfLimit", { pct: percentage })
        : contactLine(customer.phone, customer.address),
      detailTone: percentage != null && percentage > 85 ? "danger" : "muted",
    };
  });
  const supplierRows: DashboardDebtRow[] = data.topSuppliers.map((supplier) => ({
    ...supplier,
    detail: contactLine(supplier.phone, supplier.address),
  }));

  return (
    <>
      <div className="min-h-full bg-canvas lg:hidden">
        <MobileTopBar
          title={context.storeName.trim() || "LumaPOS"}
          trailing={(
            <Link
              href={Routes.Notifications}
              aria-label={t("nav.notifications")}
              data-button-radius="pill"
              className="grid size-11 place-items-center rounded-full bg-surface text-ios-label-secondary transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent"
            >
              <Bell className="size-[22px]" strokeWidth={2} />
            </Link>
          )}
        />
        {/* Section order mirrors DashboardView.swift. */}
        <div className="space-y-ios-section px-ios-inset pb-6 pt-2">
          <section className="rounded-[22px] bg-surface px-ios-inset py-3 shadow-[0_4px_12px_color-mix(in_oklab,var(--primary-600)_3.5%,transparent)]">
            <h2 className="text-[17px] font-bold leading-[22px]">{t("mobile.dashboard.businessStats")}</h2>
            <div className="mt-2.5">
              <MobileSegmentedLinks
                label={t("mobile.dashboard.rangeLabel")}
                items={MOBILE_RANGES.map((r) => ({
                  href: `${Routes.Dashboard}?range=${r}`,
                  label: t(`dashboard.range.${r}`),
                  active: range === r,
                }))}
              />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <MobileMetricTile
                icon={BarChart3}
                label={t("mobile.dashboard.revenue")}
                value={formatCompactCurrency(data.revenue, locale)}
                detail={t("mobile.dashboard.ordersCount", { count: data.orderCount })}
                href={Routes.Reports}
              />
              <MobileProfitMetricTile
                label={t("mobile.dashboard.grossProfit")}
                value={formatCompactCurrency(data.grossProfit, locale)}
                margin={t("mobile.dashboard.marginPct", { pct: marginFormatter.format(data.marginPct) })}
                hiddenMargin={t("mobile.dashboard.hiddenMargin")}
              />
              <MobileMetricTile
                icon={FileText}
                label={t("mobile.dashboard.orderCount")}
                value={formatNumber(data.orderCount)}
                detail={data.orderCount > 0
                  ? t("mobile.dashboard.avgPerOrder", { amount: formatCompactCurrency(data.avgOrder, locale) })
                  : "—"}
                href={Routes.Sales}
              />
              <MobileMetricTile
                icon={Users}
                tint="red"
                label={t("mobile.dashboard.receivablesFull")}
                value={formatCompactCurrency(data.debt.total, locale)}
                detail={t("mobile.dashboard.debtorsCount", { count: data.debt.debtors })}
                href={`${Routes.Customers}?owing=1`}
              />
            </div>
          </section>

          <MobileQuickActionGrid
            title={t("mobile.dashboard.quickActions")}
            items={[
              { href: Routes.POS, icon: ShoppingCart, label: t("mobile.dashboard.newSale") },
              { href: Routes.POS, icon: ScanLine, label: t("mobile.dashboard.scan") },
              { href: Routes.PurchaseNew, icon: Package, label: t("mobile.dashboard.receive") },
              { href: `${Routes.Inventory}?tab=stock`, icon: ListChecks, label: t("mobile.dashboard.stocktake") },
            ]}
          />

          <section className="rounded-2xl bg-surface p-3.5">
            <MobileCardHeader title={t("mobile.dashboard.lowStockTitle")} href={`${Routes.Inventory}?low=1`} linkLabel={t("mobile.dashboard.seeAll")} />
            {data.lowStock.length === 0 ? (
              <p className="flex min-h-14 items-center justify-center text-[15px] text-ios-label-secondary">
                {data.lowStockCount === 0
                  ? t("mobile.dashboard.lowStockEmpty")
                  : t("mobile.dashboard.lowStockNeedCheck", { count: data.lowStockCount })}
              </p>
            ) : (
              <div className="mt-2.5 divide-y divide-border">
                {data.lowStock.slice(0, 5).map((product) => {
                  const stock = Number(product.totalStock);
                  const min = Number(product.minLevel);
                  const outOfStock = stock <= 0;
                  const critical = outOfStock || stock <= min / 2;
                  const unit = product.baseUnit?.trim();
                  return (
                    <Link key={product.id} href={Routes.product(product.id)}
                      className="flex min-h-14 items-center gap-2.5 py-[9px] transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent">
                      <span className={cn("grid size-[38px] shrink-0 place-items-center rounded-[10px]", critical ? "bg-ios-red/12 text-ios-red" : "bg-ios-orange/12 text-ios-orange")} aria-hidden="true">
                        <Package className="size-[18px]" strokeWidth={2.2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{productDisplayName(product)}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-ios-label-secondary">
                          {unit
                            ? t("mobile.dashboard.stockOfMin", { stock: formatNumber(stock), unit, min: formatNumber(min) })
                            : t("mobile.dashboard.stockOfMinNoUnit", { stock: formatNumber(stock), min: formatNumber(min) })}
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-[9px] py-[5px] text-[11px] font-semibold", critical ? "bg-ios-red/12 text-ios-red" : "bg-ios-orange/12 text-ios-orange")}>
                        {t(outOfStock ? "mobile.dashboard.badgeOutOfStock" : critical ? "mobile.dashboard.badgeCritical" : "mobile.dashboard.badgeLow")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link
              href={Routes.PurchaseNew}
              className="mt-2.5 flex min-h-11 items-center justify-center rounded-xl bg-canvas text-[15px] font-semibold ring-[0.5px] ring-inset ring-ios-stroke transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent"
            >
              {t("mobile.dashboard.createPurchase")}
            </Link>
          </section>

          <MobileDashboardOfflineNotice />

          <section className="rounded-2xl bg-surface p-3.5">
            <MobileCardHeader title={t("mobile.dashboard.recentSales")} href={Routes.Sales} linkLabel={t("mobile.dashboard.seeAll")} />
            {data.recentOrders.length === 0 ? (
              <p className="flex min-h-[88px] items-center justify-center text-[15px] text-ios-label-secondary">{t("mobile.dashboard.recentEmpty")}</p>
            ) : (
              <div className="mt-1 divide-y divide-border">
                {data.recentOrders.slice(0, 2).map((order) => (
                  <div key={order.id} className="flex min-h-[82px] items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <OrderDetailLink
                        orderId={order.id}
                        className="block truncate text-[15px] font-semibold text-ios-accent"
                      >
                        {order.customerName || t("orders.walkIn")}
                      </OrderDetailLink>
                      <span className="mt-1 block truncate text-[12px] text-ios-label-secondary">
                        {order.code} · {formatDate(order.createdAt)}
                      </span>
                      <span className="mt-1.5 inline-flex flex-wrap gap-1.5">
                        <OrderStatusBadge status={order.status} />
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </span>
                    </div>
                    <span className="max-w-[45%] shrink-0 text-right text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {formatCurrency(Number(order.total))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {debtorRows.length > 0 && (
            <DashboardDebtCard
              mobile
              kind="customer"
              title={t("mobile.dashboard.debtTitle")}
              href={`${Routes.Customers}?owing=1`}
              linkLabel={t("mobile.dashboard.seeAll")}
              totalLabel={t("mobile.dashboard.totalReceivable")}
              rows={debtorRows}
              total={data.debt.total}
            />
          )}
          {supplierRows.length > 0 && (
            <DashboardDebtCard
              mobile
              kind="supplier"
              title={t("mobile.dashboard.payablesTitle")}
              href={`${Routes.Suppliers}?owing=owing`}
              linkLabel={t("mobile.dashboard.seeAll")}
              totalLabel={t("mobile.dashboard.totalPayable")}
              rows={supplierRows}
              total={data.payables.total}
            />
          )}
        </div>
      </div>

      <div className="hidden space-y-5 p-4 sm:p-6 lg:block">
      {/* header — title + range selector + nút bán hàng */}
      <div className="flex items-center gap-3 flex-wrap">
        <Text as="h1" size="2xl" weight="bold" className="min-w-0 flex-1 sm:flex-none" text={t("dashboard.title")} />
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <div className="bg-surface rounded-card border border-border p-4 sm:p-5">
          <div className="text-xs font-semibold text-slate-500">{t(`dashboard.revenueLabel.${range}`)}</div>
          <div className="mt-1.5 break-words text-[18px] font-extrabold leading-tight tabular-nums sm:text-[22px]">{formatCurrency(data.revenue)}</div>
          <div className="text-xs text-ok mt-1">{t("dashboard.ordersCount", { count: data.orderCount })}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-4 sm:p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.grossProfit")}</div>
          <div className="mt-1.5 break-words text-[18px] font-extrabold leading-tight tabular-nums sm:text-[22px]">{formatCurrency(data.grossProfit)}</div>
          <div className="text-xs text-ok mt-1">{t("dashboard.marginPct", { pct: data.marginPct.toFixed(1) })}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-4 sm:p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.ordersLabel")}</div>
          <div className="mt-1.5 text-[18px] font-extrabold leading-tight tabular-nums sm:text-[22px]">{data.orderCount}</div>
          <div className="text-xs text-slate-400 mt-1">{data.orderCount > 0 ? t("dashboard.avgPerOrder", { avg: formatCurrency(Math.round(data.avgOrder)) }) : "—"}</div>
        </div>
        <div className="bg-surface rounded-card border border-border p-4 sm:p-5">
          <div className="text-xs font-semibold text-slate-500">{t("dashboard.receivable")}</div>
          <div className="mt-1.5 break-words text-[18px] font-extrabold leading-tight tabular-nums text-warn sm:text-[22px]">{formatCurrency(data.debt.total)}</div>
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
                        <div className="font-semibold text-[13px] truncate">{productDisplayName(p)}</div>
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
                      <OrderDetailLink orderId={o.id} className="font-semibold text-primary-600 hover:underline">
                        {o.code}
                      </OrderDetailLink>
                    </td>
                    <td className="px-4 py-3">
                      <PartnerDetailLink kind="customer" partnerId={o.customerId} name={o.customerName ?? t("orders.walkIn")} openInCurrentTab />
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

        <div className="space-y-4">
          {debtorRows.length > 0 && (
            <DashboardDebtCard
              kind="customer"
              title={t("dashboard.topDebtors")}
              href={`${Routes.Customers}?owing=1`}
              linkLabel={t("dashboard.debtLink")}
              totalLabel={t("dashboard.totalReceivable")}
              rows={debtorRows}
              total={data.debt.total}
            />
          )}
          {supplierRows.length > 0 && (
            <DashboardDebtCard
              kind="supplier"
              title={t("dashboard.topSuppliers")}
              href={`${Routes.Suppliers}?owing=owing`}
              linkLabel={t("dashboard.supplierDebtLink")}
              totalLabel={t("dashboard.totalPayables")}
              rows={supplierRows}
              total={data.payables.total}
            />
          )}
        </div>
      </div>
      <Text as="span" className="hidden" text={formatDate(new Date())} />
      </div>
    </>
  );
}

function DashboardDebtCard({
  kind,
  title,
  href,
  linkLabel,
  totalLabel,
  rows,
  total,
  mobile = false,
}: {
  kind: "customer" | "supplier";
  title: string;
  href: string;
  linkLabel: string;
  totalLabel: string;
  rows: DashboardDebtRow[];
  total: number;
  /** Native DashboardTopDebtorsView/TopSuppliersView presentation for phones. */
  mobile?: boolean;
}) {
  const list = (
    <div className={cn("divide-y", mobile ? "divide-border" : "divide-border-soft")}>
      {rows.slice(0, 5).map((row) => {
        const initials = row.name.split(" ").map((word) => word[0]).slice(-2).join("").toUpperCase();
        return (
          <div key={row.id} className={cn("flex items-center", mobile ? "gap-2.5 py-[9px]" : "gap-3 py-2.5")}>
            <div className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full font-bold",
              mobile
                ? "bg-primary-600/12 text-[11px] text-primary-600"
                : "bg-primary-50 text-[11px] text-primary-700 dark:bg-primary-950/50 dark:text-primary-400",
            )}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <PartnerDetailLink
                kind={kind}
                partnerId={row.id}
                name={row.name}
                openInCurrentTab
                className={mobile
                  ? "-my-3 block truncate py-3 text-[15px] font-semibold leading-5 text-ios-accent"
                  : "block whitespace-normal break-words text-[13px] font-semibold"}
              />
              {row.detail && (
                <div className={cn(
                  "line-clamp-2 break-words",
                  mobile ? "mt-0.5 text-[12px]" : "text-xs",
                  row.detailTone === "danger" ? (mobile ? "text-ios-red" : "text-er") : (mobile ? "text-ios-label-secondary" : "text-slate-400"),
                )}>
                  {row.detail}
                </div>
              )}
            </div>
            <b className={cn(
              "shrink-0 text-right tabular-nums",
              mobile ? "text-[12px] font-semibold" : "text-[13px]",
              kind === "customer" ? (mobile ? "text-ios-red" : "text-er") : (mobile ? "text-ios-orange" : "text-warn"),
            )}>
              {formatCurrency(Number(row.currentDebt))}
            </b>
          </div>
        );
      })}
    </div>
  );

  if (mobile) {
    return (
      <section className="rounded-2xl bg-surface p-3.5">
        <MobileCardHeader title={title} href={href} linkLabel={linkLabel} />
        <div className="mt-1">{list}</div>
        <div className="mt-2.5 flex justify-between gap-3 border-t border-border pt-3.5 text-[15px]">
          <span className="text-ios-label-secondary">{totalLabel}</span>
          <b className="font-semibold tabular-nums">{formatCurrency(total)}</b>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-5">
        <Text as="h2" weight="bold" className="min-w-0" text={title} />
        <Link href={href} className="shrink-0 text-xs font-medium text-primary-600 hover:underline">
          {linkLabel}
        </Link>
      </div>
      <div className="px-3 py-1 sm:p-4">
        {list}
        <div className="mt-2 flex justify-between gap-3 border-t border-border pt-3 text-sm">
          <Text as="span" variant="muted" text={totalLabel} />
          <b className="tabular-nums">{formatCurrency(total)}</b>
        </div>
      </div>
    </section>
  );
}

function contactLine(phone?: string | null, address?: string | null) {
  const contact = [phone, address]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return contact.length > 0 ? contact.join(" · ") : null;
}

/** NativeDashboardFormatting.compactMetricMoney: "163M ₫", "1,2B ₫", "950 ₫". */
function formatCompactCurrency(value: number, locale: string) {
  const magnitude = Math.abs(value);
  const numberLocale = locale === "en" ? "en-US" : "vi-VN";
  const [divisor, suffix] = magnitude >= 999_950_000 ? [1_000_000_000, "B"]
    : magnitude >= 999_950 ? [1_000_000, "M"]
    : magnitude >= 1_000 ? [1_000, "K"]
    : [1, ""];
  const scaled = value / divisor;
  const digits = new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: divisor > 1 && Math.abs(scaled) < 10 ? 1 : 0,
    minimumFractionDigits: 0,
  }).format(scaled);
  return `${digits}${suffix} ₫`;
}

