import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { getReturn } from "@/lib/data/returns";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { OrderDetailLink } from "@/components/order-detail-link";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";

type ReturnDetail = NonNullable<Awaited<ReturnType<typeof getReturn>>>;

export async function ReturnDetailPanel({ ret, compact = false }: { ret: ReturnDetail; compact?: boolean }) {
  const t = await getTranslations();
  const printTemplates = await getPrintTemplatesForDoc("return");
  const exchangeDifference = Number(ret.exchangeDifference ?? 0);

  return (
    <div className={cn("bg-surface", compact ? "px-4 py-4" : "space-y-4")}>
      <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", compact && "mb-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{ret.customerName ?? t("orders.walkIn")}</h2>
            <span className="text-sm font-semibold text-slate-500">{ret.code}</span>
            {ret.orderId && ret.orderCode && (
              <OrderDetailLink orderId={ret.orderId} className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">
                {ret.orderCode}
              </OrderDetailLink>
            )}
          </div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            <InfoLine label={t("orders.cols.date")} value={formatDate(ret.createdAt)} />
            <InfoLine label={t("returns.reason")} value={ret.reason ? t(`returns.reasons.${ret.reason}` as never) : "—"} />
            <InfoLine label={t("returns.refundVia")} value={t(`returns.refundMethods.${ret.refundMethod}`)} />
            <InfoLine label={t("returns.cols.warehouse")} value={ret.warehouseName ?? "—"} />
            <InfoLine label={t("returns.cols.createdBy")} value={ret.createdByName ?? "—"} />
            <InfoLine label={t("customers.cols.phone")} value={ret.customerPhone ?? "—"} />
          </div>
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", compact ? "xl:grid-cols-[1fr_300px]" : "lg:grid-cols-[1fr_320px]")}>
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="sales-return-items">
              {ret.items.map((item) => (
                <div key={item.id} className="space-y-2 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-semibold">{item.productName}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{formatNumber(Number(item.quantity))} {item.unitName} × {formatCurrency(Number(item.unitPrice))}</div>
                    </div>
                    <div className="shrink-0 font-semibold tabular-nums text-er">- {formatCurrency(Number(item.total))}</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {t("returns.cols.restock")}: {item.restock ? t("returns.restockYes") : t("returns.restockNo")}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                    <th className="px-3 py-3">{t("orders.cols.product")}</th>
                    <th className="px-3 py-3">{t("orders.cols.unit")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.qty")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.unitPrice")}</th>
                    <th className="px-3 py-3 text-right">{t("returns.cols.refund")}</th>
                    <th className="px-3 py-3">{t("returns.cols.restock")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {ret.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-3 font-medium">{item.productName}</td>
                      <td className="px-3 py-3 text-slate-500">{item.unitName}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitPrice))}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-er">- {formatCurrency(Number(item.total))}</td>
                      <td className="px-3 py-3 text-slate-500">{item.restock ? t("returns.restockYes") : t("returns.restockNo")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="min-h-[120px] rounded-lg border border-border px-4 py-3 text-sm text-slate-400">
            {ret.note || t("orders.detail.notePlaceholder")}
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("orders.detail.customer")}</div>
            <InfoLine label={t("orders.cols.customer")} value={ret.customerName ?? t("orders.walkIn")} />
            <InfoLine label={t("customers.cols.phone")} value={ret.customerPhone ?? "—"} />
          </div>

          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("orders.detail.info")}</div>
            <InfoLine label={t("returns.sourceOrder")} value={ret.orderCode ?? "—"} />
            {ret.exchangeOrderId && ret.exchangeOrderCode && (
              <InfoLine label={t("returns.exchangeOrder")}>
                <OrderDetailLink orderId={ret.exchangeOrderId} className="font-semibold text-primary-600 hover:underline">
                  {ret.exchangeOrderCode}
                </OrderDetailLink>
              </InfoLine>
            )}
            <InfoLine label={t("returns.refundVia")} value={t(`returns.refundMethods.${ret.refundMethod}`)} />
            <InfoLine label={t("returns.totalRefund")} value={formatCurrency(Number(ret.totalRefund))} valueClassName="text-base text-er" strong />
            {ret.exchangeOrderId && (
              <>
                <InfoLine
                  label={t("returns.exchangeDifference")}
                  value={t(
                    exchangeDifference > 0
                      ? "returns.exchangeCollect"
                      : exchangeDifference < 0
                        ? "returns.exchangeRefund"
                        : "returns.exchangeEven",
                    { amount: formatCurrency(Math.abs(exchangeDifference)) },
                  )}
                  strong
                />
                {ret.exchangeSettlementMethod && exchangeDifference !== 0 && (
                  <InfoLine
                    label={t("returns.exchangeSettlement")}
                    value={t(`returns.refundMethods.${ret.exchangeSettlementMethod}` as never)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border-soft pt-4">
        <PrintTemplateMenu baseHref={`/returns/${ret.id}/print`} templates={printTemplates} label={t("returns.print")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0")} />
      </div>
    </div>
  );
}

function InfoLine({
  label,
  value,
  children,
  valueClassName,
  strong,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  valueClassName?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-right tabular-nums", strong && "font-semibold", valueClassName)}>
        {children ?? value ?? "—"}
      </span>
    </div>
  );
}
