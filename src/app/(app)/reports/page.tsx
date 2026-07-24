import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getReports } from "@/lib/data/reports";
import { buttonVariants } from "@/components/ui/button-variants";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";

interface PageProps {
  searchParams: Promise<{ tab?: string; range?: string; customerId?: string; customer?: string; q?: string; source?: string }>;
}

const RANGES = [7, 30, 90] as const;
const REPORT_TABS = [
  { tab: "overview", labelKey: "reports.overview" },
  { tab: "products", labelKey: "reports.products" },
  { tab: "customers", labelKey: "reports.customers" },
  { tab: "employees", labelKey: "reports.employees" },
];
const REPORT_FILTER_PARAMS = ["range", "customerId", "customer", "q", "source"] as const;

export default async function ReportsPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const activeTab = REPORT_TABS.find((item) => item.tab === params.tab)?.tab ?? "overview";
  const range = RANGES.includes(Number(params.range) as 7) ? Number(params.range) : 30;
  const filters = {
    customerId: typeof params.customerId === "string" ? params.customerId : undefined,
    customer: typeof params.customer === "string" ? params.customer : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
  };
  const data = await getReports(range, filters);
  const filterParams = new URLSearchParams();
  if (filters.customerId) filterParams.set("customerId", filters.customerId);
  if (filters.customer) filterParams.set("customer", filters.customer);
  if (filters.q) filterParams.set("q", filters.q);
  if (params.source) filterParams.set("source", params.source);
  if (activeTab !== "overview") filterParams.set("tab", activeTab);
  const filterQuery = filterParams.toString();
  const filterLabel = filters.customer || filters.q || (filters.customerId ? `ID ${filters.customerId.slice(0, 8)}` : "");

  const maxDay = Math.max(1, ...data.byDay.map((d) => Math.abs(Number(d.revenue))));
  const uncollected = data.summary.revenue - data.summary.collected;
  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-[52px] px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("reports.title")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5">
          <GroupTabs base={Routes.Reports} items={REPORT_TABS} preserveParams={REPORT_FILTER_PARAMS} />
        </div>
      </div>

      <div className="mb-5 flex w-full justify-end gap-1.5 overflow-x-auto">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`${Routes.Reports}?range=${r}${filterQuery ? `&${filterQuery}` : ""}`}
            className={cn(
              buttonVariants({ variant: range === r ? "default" : "outline", size: "sm" }),
              "h-9 flex-1 whitespace-nowrap sm:flex-none"
            )}
          >
            {t("reports.lastNDays", { n: r })}
          </Link>
        ))}
      </div>

      {filterLabel && (
        <div className="mb-5 rounded-card border border-primary-200 bg-primary-50 px-4 py-3 text-sm font-semibold text-primary-700">
          Báo cáo đang lọc theo khách: {filterLabel}
        </div>
      )}

      {activeTab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.revenue")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{formatCurrency(data.summary.revenue)}</div>
              {data.summary.refundTotal > 0 && (
                <div className="mt-1 text-xs font-medium text-er">
                  {t("reports.returnsDeducted", { amount: formatCurrency(data.summary.refundTotal) })}
                </div>
              )}
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.collected")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1 text-ok">{formatCurrency(data.summary.collected)}</div>
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.uncollected")}</div>
              <div className={cn("text-2xl font-bold tabular-nums mt-1", uncollected > 0 ? "text-er" : "")}>{formatCurrency(uncollected)}</div>
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.orders")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{data.summary.orderCount}</div>
              <div className="text-xs text-slate-400 mt-1">
                {data.summary.orderCount > 0 && t("reports.avgOrder", { avg: formatCurrency(Math.round(data.summary.revenue / data.summary.orderCount)) })}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("reports.invoiceList")}</div>
            {data.invoices.length === 0 ? (
              <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                      <th className="px-4 py-2.5 font-semibold">{t("orders.cols.code")}</th>
                      <th className="px-4 py-2.5 font-semibold">{t("orders.cols.date")}</th>
                      <th className="px-4 py-2.5 font-semibold">{t("orders.cols.customer")}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">{t("orders.cols.total")}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">{t("reports.collected")}</th>
                      <th className="px-4 py-2.5 text-right font-semibold">{t("reports.profit")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {data.invoices.map((invoice) => {
                      const profit = Number(invoice.profit);
                      return (
                        <tr key={invoice.id}>
                          <td className="px-4 py-2.5">
                            <Link href={Routes.salesOrder(invoice.id, invoice.status)} className="font-semibold text-primary-600 hover:underline">
                              {invoice.code}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDate(invoice.createdAt)}</td>
                          <td className="px-4 py-2.5 font-medium">{invoice.customerName}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(invoice.total))}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-ok">{formatCurrency(Number(invoice.amountPaid))}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", profit >= 0 ? "text-ok" : "text-er")}>
                            {formatCurrency(profit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-surface rounded-card border border-border p-5">
            <Text as="h2" weight="semibold" className="mb-4" text={t("dashboard.revenueByDay")} />
            {data.byDay.length === 0 ? (
              <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
            ) : (
              <div className="flex items-end gap-1 h-44 overflow-x-auto">
                {data.byDay.map((d) => {
                  const v = Number(d.revenue);
                  return (
                    <div key={d.day} className="flex-1 min-w-6 flex flex-col items-center justify-end h-full gap-1" title={`${d.day}: ${formatCurrency(v)}`}>
                      <div
                        className={cn("w-full rounded-t", v < 0 ? "bg-er/85" : "bg-primary-600/85")}
                        style={{ height: `${Math.max(2, (Math.abs(v) / maxDay) * 100)}%` }}
                      />
                      <Text as="span" variant="muted" className="text-[9px] whitespace-nowrap" text={`${d.day.slice(8)}/${d.day.slice(5, 7)}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "products" && (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {data.topProducts.length === 0 ? (
            <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.qtySold")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.revenue")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.grossProfit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.topProducts.map((p) => {
                  const profit = Number(p.profit);
                  return (
                    <tr key={p.productId}>
                      <td className="px-4 py-2.5 font-medium">{p.productName}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(Number(p.qtySold))} {p.baseUnit}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(p.revenue))}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", profit >= 0 ? "text-ok" : "text-er")}>
                        {formatCurrency(profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "customers" && (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {data.byCustomer.length === 0 ? (
            <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.customer")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.orders")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.revenue")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.uncollected")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.byCustomer.map((c) => {
                  const remaining = Number(c.remaining);
                  return (
                    <tr key={c.customerId ?? "walkin"}>
                      <td className="px-4 py-2.5 font-medium">
                        {c.customerName}
                        {c.customerType && c.customerType !== "retail" && (
                          <Text as="span" variant="muted" size="xs" text={` (${t(`customers.types.${c.customerType}` as never)})`} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.orderCount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(c.revenue))}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", remaining > 0 ? "text-er font-semibold" : "text-slate-400")}>
                        {remaining > 0 ? formatCurrency(remaining) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "employees" && (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {data.byEmployee.length === 0 ? (
            <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("reports.employee")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.orders")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.revenue")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("reports.collected")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.byEmployee.map((e) => (
                  <tr key={e.sellerId ?? "system"}>
                    <td className="px-4 py-2.5 font-medium">{e.sellerName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{e.orderCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(e.revenue))}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ok">{formatCurrency(Number(e.collected))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
