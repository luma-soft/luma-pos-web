import { getTranslations } from "next-intl/server";
import { Printer } from "lucide-react";
import type { OrderDetail } from "@/lib/data/orders";
import { productDisplayName } from "@/lib/products/variant-presentation";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import type { getPrintTemplatesForDoc } from "@/lib/print/template";
import { MergeConfirm } from "./merge-confirm";

type PrintTemplates = Awaited<ReturnType<typeof getPrintTemplatesForDoc>>;

export async function MergeOrderDetailPreview({
  selectedOrders,
  eligibleOrders,
  ids,
  printHref,
  printTemplates,
  canMerge,
  sameCustomer,
  hasReturns,
  hasEInvoice,
}: {
  selectedOrders: OrderDetail[];
  eligibleOrders: OrderDetail[];
  ids: string[];
  printHref: string;
  printTemplates: PrintTemplates;
  canMerge: boolean;
  sameCustomer: boolean;
  hasReturns: boolean;
  hasEInvoice: boolean;
}) {
  const t = await getTranslations();
  const sourceOrders = eligibleOrders;
  const firstOrder = sourceOrders[0] ?? selectedOrders[0];
  const total = sourceOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const paid = sourceOrders.reduce((sum, order) => sum + Number(order.amountPaid), 0);
  const subtotal = sourceOrders.reduce((sum, order) => sum + Number(order.subtotal), 0);
  const discount = sourceOrders.reduce((sum, order) => sum + Number(order.discount), 0);
  const tax = sourceOrders.reduce((sum, order) => sum + Number(order.tax), 0);
  const shippingFee = sourceOrders.reduce((sum, order) => sum + Number(order.shippingFee), 0);
  const remaining = Math.max(0, total - paid);
  const items = sourceOrders.flatMap((order) => order.items)
    .sort((left, right) => Number(left.lineOrder) - Number(right.lineOrder) || left.id.localeCompare(right.id));
  const payments = sourceOrders.flatMap((order) => order.payments.map((payment) => ({
    ...payment,
    sourceCode: order.code,
  }))).sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));

  if (!firstOrder) return null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="rounded-xl border border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900 dark:bg-primary-950/20">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t("merge.previewTitle")}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{t("merge.previewNotice")}</p>
          </div>
          <span className="mt-2 inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-inset ring-primary-200 sm:mt-0 dark:bg-surface dark:text-primary-300 dark:ring-primary-900">
            {t("merge.previewCode")}
          </span>
        </div>
      </div>

      {(selectedOrders.length === 0) ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-slate-400">
          <p>{t("merge.noneSelected")}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <section className="overflow-hidden rounded-card border border-border bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
                  <h4 className="font-semibold">{t("merge.sources")}</h4>
                  <span className="text-sm text-slate-500">{selectedOrders.length}</span>
                </div>
                <div className="divide-y divide-border-soft">
                  {selectedOrders.map((order) => {
                    const invalid = order.status !== "completed" || !order.customerId;
                    return (
                      <div key={order.id} className={cn(
                        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
                        invalid && "bg-red-50 dark:bg-red-950/30",
                      )}>
                        <div className="min-w-0 flex-1">
                          <p className="break-all font-semibold">{order.code}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                            <span>{formatDate(order.createdAt)}</span>
                            <span>{order.customerName ?? t("orders.walkIn")}</span>
                          </div>
                          {invalid && (
                            <p className="mt-1 text-xs font-medium text-er">
                              {!order.customerId ? t("merge.errNoCustomer") : t("merge.errStatus")}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-left font-semibold tabular-nums sm:text-right">
                          {formatCurrency(Number(order.total))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="overflow-hidden rounded-card border border-border bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
                  <h4 className="font-semibold">{t("merge.products")}</h4>
                  <span className="text-sm text-slate-500">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">{t("merge.noProducts")}</p>
                ) : (
                  <>
                    <div className="divide-y divide-border-soft lg:hidden">
                      {items.map((item) => {
                        const pricing = readOrderLinePricing(item);
                        return (
                          <div key={item.id} className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 font-medium">
                                {productDisplayName({
                                  name: item.productName,
                                  variantName: item.productVariantName,
                                  specs: item.productSpecs,
                                })}
                                {item.priceBookName && <div className="mt-1 text-xs font-normal text-slate-500">{item.priceBookName}</div>}
                              </div>
                              <div className="shrink-0 font-semibold tabular-nums">{formatCurrency(Number(item.total))}</div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>{formatNumber(Number(item.quantity))} {item.unitName}</span>
                              <span>× {formatCurrency(pricing.unitPrice)}</span>
                              {pricing.discount > 0 && <span>{t("orders.cols.discount")}: {formatCurrency(pricing.discount)}</span>}
                              <span>{t("orders.cols.unitPriceAfterDiscount")}: {formatCurrency(pricing.netUnitPrice)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="hidden overflow-x-auto lg:block">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                            <th className="px-3 py-3">{t("orders.cols.product")}</th>
                            <th className="px-3 py-3">{t("orders.cols.unit")}</th>
                            <th className="px-3 py-3 text-right">{t("orders.cols.qty")}</th>
                            <th className="px-3 py-3 text-right">{t("orders.cols.unitPrice")}</th>
                            <th className="px-3 py-3 text-right">{t("orders.cols.discount")}</th>
                            <th className="px-3 py-3 text-right">{t("orders.cols.unitPriceAfterDiscount")}</th>
                            <th className="px-3 py-3 text-right">{t("orders.cols.lineTotal")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-soft">
                          {items.map((item) => {
                            const pricing = readOrderLinePricing(item);
                            return (
                              <tr key={item.id}>
                                <td className="px-3 py-3 font-medium">
                                  {productDisplayName({
                                    name: item.productName,
                                    variantName: item.productVariantName,
                                    specs: item.productSpecs,
                                  })}
                                  {item.priceBookName && <div className="mt-1 text-xs font-normal text-slate-500">{item.priceBookName}</div>}
                                </td>
                                <td className="px-3 py-3 text-slate-500">{item.unitName}</td>
                                <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.unitPrice)}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                                  {pricing.discount > 0 ? formatCurrency(pricing.discount) : "—"}
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.netUnitPrice)}</td>
                                <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(Number(item.total))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>

              <section className="overflow-hidden rounded-card border border-border bg-surface">
                <div className="border-b border-border-soft px-4 py-3 font-semibold">{t("orders.detail.payments")}</div>
                {payments.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">{t("orders.detail.noPayments")}</p>
                ) : (
                  <div className="divide-y divide-border-soft">
                    {payments.map((payment) => (
                      <div key={payment.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{t(("pos.payMethods." + payment.method) as never)}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatDate(payment.createdAt)} · {payment.sourceCode}
                          </p>
                          {(payment.reference || payment.note) && (
                            <p className="mt-1 break-words text-xs text-slate-500">
                              {[payment.reference, payment.note].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                        <p className="shrink-0 font-semibold tabular-nums text-ok">+ {formatCurrency(Number(payment.amount))}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-card border border-border bg-surface p-4">
                <h4 className="mb-2 font-semibold">{t("orders.detail.info")}</h4>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t("merge.sourceNote", { codes: selectedOrders.map((order) => order.code).join(", ") })}
                </p>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="space-y-2 rounded-card border border-border bg-surface p-4 text-sm">
                <h4 className="font-semibold">{t("orders.detail.customer")}</h4>
                <PreviewInfoRow label={t("orders.cols.customer")} value={firstOrder.customerName ?? t("orders.walkIn")} />
                <PreviewInfoRow label={t("customers.cols.phone")} value={firstOrder.customerPhone ?? "—"} />
                <PreviewInfoRow
                  label={t("customers.cols.debt")}
                  value={formatCurrency(Number(firstOrder.customerDebt ?? 0))}
                  valueClassName={Number(firstOrder.customerDebt ?? 0) > 0 ? "text-er" : "text-slate-500"}
                />
              </section>

              <section className="space-y-2 rounded-card border border-border bg-surface p-4 text-sm">
                <h4 className="font-semibold">{t("merge.paymentSummary")}</h4>
                <PreviewInfoRow label={t("pos.subtotal")} value={formatCurrency(subtotal)} />
                <PreviewInfoRow label={t("pos.discount")} value={formatCurrency(discount)} />
                <PreviewInfoRow label={t("pos.tax")} value={formatCurrency(tax)} />
                <PreviewInfoRow label={t("pos.shipping")} value={formatCurrency(shippingFee)} />
                <PreviewInfoRow label={t("pos.total")} value={formatCurrency(total)} strong valueClassName="text-primary-600" />
                <PreviewInfoRow label={t("orders.detail.paid")} value={formatCurrency(paid)} strong valueClassName={paid > 0 ? "text-ok" : undefined} />
                <PreviewInfoRow label={t("orders.detail.remaining")} value={formatCurrency(remaining)} strong valueClassName={remaining > 0 ? "text-er" : "text-ok"} />
              </section>
            </aside>
          </div>

          {(!sameCustomer && selectedOrders.length > 1 || hasReturns || hasEInvoice || eligibleOrders.length !== selectedOrders.length) && (
            <div className="space-y-1 rounded-lg border border-er/20 bg-er-soft p-3 text-sm text-er">
              {!sameCustomer && selectedOrders.length > 1 && <p>{t("merge.errors.sameCustomer")}</p>}
              {hasReturns && <p>{t("merge.errors.hasReturns")}</p>}
              {hasEInvoice && <p>{t("merge.errors.hasEInvoice")}</p>}
              {eligibleOrders.length !== selectedOrders.length && <p>{t("merge.errStatus")}</p>}
            </div>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col gap-3 border-t border-border-soft bg-surface/95 px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:-mx-6 sm:-mb-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
            <p className="hidden min-w-0 flex-1 text-xs leading-5 text-slate-500 sm:block">{t("merge.hint")}</p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
              {canMerge ? (
                <PrintTemplateMenu
                  baseHref={printHref}
                  templates={printTemplates}
                  label={t("merge.printSample")}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-surface-2 sm:w-auto dark:text-slate-200"
                />
              ) : (
                <button type="button" disabled className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-400 disabled:cursor-not-allowed sm:w-auto">
                  <Printer className="h-4 w-4" />
                  {t("merge.printSample")}
                </button>
              )}
              <MergeConfirm ids={ids} disabled={!canMerge} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PreviewInfoRow({
  label,
  value,
  strong = false,
  valueClassName,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-right tabular-nums", strong && "font-semibold", valueClassName)}>{value}</span>
    </div>
  );
}
