import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { Printer, ScanEye } from "lucide-react";
import { db } from "@/db";
import { customers, einvoices, orders, returns } from "@/db/schema";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import { MergeConfirm } from "./merge-confirm";

export interface MergeOrdersPageProps {
  searchParams: Promise<{ ids?: string | string[] }>;
}

type Presentation = "page" | "modal";

export async function MergeOrdersContent({
  searchParams,
  presentation = "page",
}: MergeOrdersPageProps & { presentation?: Presentation }) {
  const [params, t, context] = await Promise.all([
    searchParams,
    getTranslations(),
    requireStoreContext(),
  ]);
  const ids = [...new Set((Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : []).filter(Boolean))].slice(0, 20);

  const [rows, printTemplates, completedReturns, issuedEInvoices] = await Promise.all([
    ids.length
      ? db
          .select({
            id: orders.id,
            code: orders.code,
            status: orders.status,
            total: orders.total,
            amountPaid: orders.amountPaid,
            createdAt: orders.createdAt,
            customerId: orders.customerId,
            customerName: customers.name,
          })
          .from(orders)
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .where(and(eq(orders.storeId, context.storeId), inArray(orders.id, ids)))
      : Promise.resolve([]),
    getPrintTemplatesForDoc(context.storeId, "order"),
    ids.length
      ? db
          .select({ orderId: returns.orderId })
          .from(returns)
          .where(and(
            eq(returns.storeId, context.storeId),
            inArray(returns.orderId, ids),
            eq(returns.status, "completed"),
          ))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({ orderId: einvoices.orderId })
          .from(einvoices)
          .where(and(
            eq(einvoices.storeId, context.storeId),
            inArray(einvoices.orderId, ids),
            eq(einvoices.status, "issued"),
          ))
      : Promise.resolve([]),
  ]);

  const eligible = rows.filter((order) => order.status === "completed" && order.customerId);
  const customerIds = new Set(eligible.map((order) => order.customerId));
  const sameCustomer = customerIds.size === 1;
  const hasReturns = completedReturns.length > 0;
  const hasEInvoice = issuedEInvoices.length > 0;
  const canMerge = eligible.length >= 2
    && sameCustomer
    && eligible.length === rows.length
    && ids.length === rows.length
    && !hasReturns
    && !hasEInvoice;

  const total = eligible.reduce((sum, order) => sum + Number(order.total), 0);
  const paid = eligible.reduce((sum, order) => sum + Number(order.amountPaid), 0);
  const previewParams = new URLSearchParams();
  ids.forEach((id) => previewParams.append("ids", id));
  const previewHref = `/orders/merge/preview?${previewParams.toString()}`;

  return (
    <div className={cn(presentation === "page" ? "max-w-3xl p-4 sm:p-6" : "space-y-4 p-4 sm:p-6")}>
      {presentation === "page" && <h1 className="mb-5 text-2xl font-bold">{t("merge.title")}</h1>}

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-slate-400">
          <p>{t("merge.noneSelected")}</p>
          <Link href={`${Routes.Sales}?tab=orders`} className="mt-2 inline-flex min-h-11 min-w-11 items-center text-sm text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">
            ← {t("orders.title")}
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="divide-y divide-border-soft lg:hidden">
              {rows.map((order) => {
                const invalid = order.status !== "completed" || !order.customerId;
                return (
                  <div key={order.id} className={cn("space-y-2 p-4", invalid && "bg-red-50 dark:bg-red-950/30")}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-all font-semibold">{order.code}</span>
                      <span className="shrink-0 text-right font-semibold tabular-nums">{formatCurrency(Number(order.total))}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-slate-500">
                      <span>{formatDate(order.createdAt)}</span>
                      <span>{order.customerName ?? t("orders.walkIn")}</span>
                    </div>
                    {invalid && <p className="text-xs font-medium text-er">{!order.customerId ? t("merge.errNoCustomer") : t("merge.errStatus")}</p>}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[700px] text-sm">
                <tbody className="divide-y divide-border-soft">
                  {rows.map((order) => {
                    const invalid = order.status !== "completed" || !order.customerId;
                    return (
                      <tr key={order.id} className={cn(invalid && "bg-red-50 dark:bg-red-950/30")}>
                        <td className="px-4 py-3 font-medium">{order.code}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
                        <td className="px-4 py-3">{order.customerName ?? t("orders.walkIn")}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(Number(order.total))}</td>
                        <td className="px-4 py-3 text-xs">
                          {invalid
                            ? <span className="font-medium text-er">{!order.customerId ? t("merge.errNoCustomer") : t("merge.errStatus")}</span>
                            : <span className="text-ok">✓</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-card border border-border bg-surface p-4 sm:p-5">
            {!sameCustomer && rows.length > 1 && <p className="mb-3 text-sm text-er">{t("merge.errors.sameCustomer")}</p>}
            {hasReturns && <p className="mb-3 text-sm text-er">{t("merge.errors.hasReturns")}</p>}
            {hasEInvoice && <p className="mb-3 text-sm text-er">{t("merge.errors.hasEInvoice")}</p>}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex justify-between gap-6"><span className="text-slate-500">{t("merge.totalMerged", { count: eligible.length })}</span><b className="tabular-nums">{formatCurrency(total)}</b></div>
                <div className="flex justify-between gap-6"><span className="text-slate-500">{t("print.paid")}</span><span className="tabular-nums text-ok">{formatCurrency(paid)}</span></div>
                <div className="flex justify-between gap-6"><span className="text-slate-500">{t("orders.detail.remaining")}</span><span className="font-semibold tabular-nums text-er">{formatCurrency(Math.max(0, total - paid))}</span></div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                {canMerge ? (
                  <>
                    <Link
                      href={previewHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-surface-2 dark:text-slate-200"
                    >
                      <ScanEye className="h-4 w-4" />
                      {t("merge.preview")}
                    </Link>
                    <PrintTemplateMenu
                      baseHref={previewHref}
                      templates={printTemplates}
                      label={t("merge.printSample")}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-surface-2 dark:text-slate-200"
                    />
                  </>
                ) : (
                  <button type="button" disabled className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-400 disabled:cursor-not-allowed">
                    <Printer className="h-4 w-4" />
                    {t("merge.printSample")}
                  </button>
                )}
                <MergeConfirm ids={eligible.map((order) => order.id)} disabled={!canMerge} />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">{t("merge.hint")}</p>
          </div>
        </>
      )}
    </div>
  );
}
