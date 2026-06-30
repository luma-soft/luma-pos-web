import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getCustomer } from "@/lib/data/partners";
import { getStoreSettings } from "@/lib/data/settings";
import { CustomerTypeBadge } from "../type-badge";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";
import { PortalLink } from "./portal-link";
import { CustomerEdit } from "./customer-edit";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const [customer, store] = await Promise.all([
    getCustomer(id).catch(() => null),
    getStoreSettings(),
  ]);
  if (!customer) notFound();

  const debt = Number(customer.currentDebt);
  const limit = Number(customer.debtLimit ?? 0);
  const owingOrders = customer.orders.filter(
    (o) => o.status !== "cancelled" && Number(o.total) - Number(o.amountPaid) > 0
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-[58px] px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <Link href={Routes.Customers} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[17px] font-bold">{customer.name}</h1>
        <CustomerTypeBadge type={customer.type} />
        <div className="ml-auto flex items-center gap-2">
          <CustomerEdit customer={{
            id: customer.id, name: customer.name, phone: customer.phone, email: customer.email,
            address: customer.address, type: customer.type, taxCode: customer.taxCode,
            debtLimit: customer.debtLimit, note: customer.note,
          }} />
          <Link href={Routes.POS} className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
            {t("orders.createViaPos")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-surface border border-border rounded-card p-4">
          <div className="text-xs font-medium text-slate-500">{t("customers.cols.debt")}</div>
          <div className={cn("text-xl font-bold mt-1 tabular-nums", debt > 0 ? "text-er" : "text-ok")}>
            {formatCurrency(debt)}
          </div>
          {limit > 0 && (
            <>
              <div className="h-1.5 rounded-full bg-surface-2 mt-2 overflow-hidden">
                <div
                  className={cn("h-full rounded-full", debt / limit > 0.85 ? "bg-red-500" : "bg-amber-500")}
                  style={{ width: `${Math.min(100, (debt / limit) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {t("customers.debtOfLimit", { pct: Math.round((debt / limit) * 100), limit: formatCurrency(limit) })}
              </p>
            </>
          )}
        </div>
        <div className="bg-surface border border-border rounded-card p-4">
          <div className="text-xs font-medium text-slate-500">{t("customers.cols.totalSpent")}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(Number(customer.totalSpent))}</div>
          <p className="text-xs text-slate-400 mt-1">{t("customers.orderCount", { count: customer.orders.length })}</p>
        </div>
        <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">{t("customers.cols.phone")}</span><span>{customer.phone ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">{t("customers.fields.address")}</span><span className="text-right">{customer.address ?? "—"}</span></div>
          {customer.taxCode && <div className="flex justify-between"><span className="text-slate-500">{t("customers.fields.taxCode")}</span><span>{customer.taxCode}</span></div>}
          {customer.note && <p className="text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">{customer.note}</p>}
        </div>
      </div>

      <div className="mb-5 max-w-md">
        <PortalLink customerId={customer.id} token={customer.portalToken} zaloConfigured={store.prefs.zalo.enabled && store.prefs.zalo.accessTokenSet && Boolean(store.prefs.zalo.portalTemplateId)} />
      </div>

      {owingOrders.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-card p-4 mb-5 text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-300 mb-2">{t("customers.owingOrders", { count: owingOrders.length })}</p>
          <div className="space-y-1">
            {owingOrders.map((o) => (
              <div key={o.id} className="flex justify-between">
                <Link href={Routes.salesOrder(o.id, o.status)} className="text-primary-600 hover:underline font-medium">{o.code}</Link>
                <span className="tabular-nums font-semibold text-er">{formatCurrency(Number(o.total) - Number(o.amountPaid))}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">{t("customers.collectHint")}</p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-card overflow-x-auto">
        <div className="px-4 py-3 border-b border-border font-semibold text-sm">
          {t("customers.orderHistory")}
        </div>
        {customer.orders.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400 text-center">{t("orders.empty")}</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-2.5 font-semibold">{t("orders.cols.code")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("orders.cols.date")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("orders.cols.project")}</th>
                <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.total")}</th>
                <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.remaining")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("orders.cols.payment")}</th>
                <th className="px-4 py-2.5 font-semibold">{t("orders.cols.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {customer.orders.map((o) => {
                const remaining = Number(o.total) - Number(o.amountPaid);
                return (
                  <tr key={o.id} className={cn("hover:bg-surface-2", o.status === "cancelled" && "opacity-60")}>
                    <td className="px-4 py-3"><Link href={Routes.salesOrder(o.id, o.status)} className="font-medium text-primary-600 hover:underline">{o.code}</Link></td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{o.projectName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(o.total))}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", remaining > 0 && o.status !== "cancelled" ? "text-er font-semibold" : "text-slate-400")}>
                      {remaining > 0 && o.status !== "cancelled" ? formatCurrency(remaining) : "—"}
                    </td>
                    <td className="px-4 py-3"><PaymentStatusBadge status={o.paymentStatus} /></td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
