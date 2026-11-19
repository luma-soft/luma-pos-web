import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { getReturn } from "@/lib/data/returns";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { buttonVariants, modalActionSizeClassName } from "@/components/ui/button-variants";
import { OrderDetailLink } from "@/components/order-detail-link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import { requireStoreContext } from "@/lib/auth/store-context";
import { ReturnActions } from "./return-actions";
import { ReturnMobileScreen } from "./return-mobile-screen";
import { productDisplayName } from "@/lib/products/variant-presentation";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";

type ReturnDetail = NonNullable<Awaited<ReturnType<typeof getReturn>>>;

function returnLinePricing(item: ReturnDetail["items"][number]) {
  if (item.orderItemId == null || item.sourceQuantity == null || item.sourceUnitPrice == null || item.sourceTotal == null) {
    const unitPrice = Number(item.unitPrice);
    return { unitPrice, netUnitPrice: unitPrice, lineDiscount: 0, discount: 0, lineDiscountMode: "vnd" as const, lineDiscountValue: 0 };
  }

  return readOrderLinePricing({
    quantity: item.sourceQuantity,
    unitPrice: item.sourceUnitPrice,
    total: item.sourceTotal,
    preDiscountUnitPrice: item.sourcePreDiscountUnitPrice,
    lineDiscountMode: item.sourceLineDiscountMode,
    lineDiscountValue: item.sourceLineDiscountValue,
  });
}

export async function ReturnDetailPanel({ ret, compact = false }: { ret: ReturnDetail; compact?: boolean }) {
  const t = await getTranslations();
  const exchangeDifference = Number(ret.exchangeDifference ?? 0);

  return (
    <div className={cn("bg-surface", compact ? "px-4 py-4" : "space-y-4")}>
      <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", compact && "mb-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 max-w-full break-words text-xl font-bold text-slate-900 dark:text-slate-100"><PartnerDetailLink kind="customer" partnerId={ret.customerId} name={ret.customerName ?? t("orders.walkIn")} className="block whitespace-normal break-words" /></h2>
            <span className="text-sm font-semibold text-slate-500">{ret.code}</span>
            <span className={cn(
              "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
              ret.status === "cancelled" ? "bg-er-soft text-er" : "bg-ok-soft text-ok",
            )}>{t(`returns.status.${ret.status}` as never)}</span>
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
            <InfoLine label={t("returns.cols.createdBy")} value={ret.createdByName ?? "—"} />
            <InfoLine label={t("customers.cols.phone")} value={ret.customerPhone ?? "—"} />
          </div>
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", compact ? "xl:grid-cols-[1fr_300px]" : "lg:grid-cols-[1fr_320px]")}>
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="sales-return-items">
              {ret.items.map((item) => {
                const pricing = returnLinePricing(item);
                const discount = pricing.lineDiscount * Number(item.quantity);
                return (
                  <div key={item.id} className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words font-semibold">{productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{formatNumber(Number(item.quantity))} {item.unitName} × {formatCurrency(pricing.unitPrice)}</div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums text-er">- {formatCurrency(Number(item.total))}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span>{t("orders.cols.discount")}: <b className="tabular-nums">{discount > 0 ? <>{pricing.lineDiscountMode === "pct" && `${formatNumber(pricing.lineDiscountValue)}% · `}{formatCurrency(discount)}</> : "—"}</b></span>
                      <span className="text-right">{t("orders.cols.unitPriceAfterDiscount")}: <b className="tabular-nums">{formatCurrency(pricing.netUnitPrice)}</b></span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {t("returns.cols.restock")}: {item.restock ? t("returns.restockYes") : t("returns.restockNo")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-xs font-semibold text-slate-500">
                    <th className="px-3 py-3">{t("orders.cols.product")}</th>
                    <th className="px-3 py-3">{t("orders.cols.unit")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.qty")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.unitPrice")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.discount")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.unitPriceAfterDiscount")}</th>
                    <th className="px-3 py-3 text-right">{t("returns.cols.refund")}</th>
                    <th className="px-3 py-3">{t("returns.cols.restock")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {ret.items.map((item) => {
                    const pricing = returnLinePricing(item);
                    const discount = pricing.lineDiscount * Number(item.quantity);
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-medium">{productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })}</td>
                        <td className="px-3 py-3 text-slate-500">{item.unitName}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.unitPrice)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-500">{discount > 0 ? <>{pricing.lineDiscountMode === "pct" && <div>{formatNumber(pricing.lineDiscountValue)}%</div>}{formatCurrency(discount)}</> : "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.netUnitPrice)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold text-er">- {formatCurrency(Number(item.total))}</td>
                        <td className="px-3 py-3 text-slate-500">{item.restock ? t("returns.restockYes") : t("returns.restockNo")}</td>
                      </tr>
                    );
                  })}
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
            <InfoLine label={t("orders.cols.customer")}><PartnerDetailLink kind="customer" partnerId={ret.customerId} name={ret.customerName ?? t("orders.walkIn")} /></InfoLine>
            <InfoLine label={t("customers.cols.phone")} value={ret.customerPhone ?? "—"} />
          </div>

          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("orders.detail.info")}</div>
            <InfoLine label={t("returns.sourceOrder")} value={ret.orderCode ?? "—"} />
            {ret.exchangeOrderId && ret.exchangeOrderCode && (
              <InfoLine label={t("returns.exchangeOrder")}>
                <OrderDetailLink orderId={ret.exchangeOrderId} className="font-semibold text-primary-600 hover:underline min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 inline-flex">
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
    </div>
  );
}

export async function ReturnDetailFooter({ ret }: { ret: ReturnDetail }) {
  const t = await getTranslations();
  const context = await requireStoreContext();
  const printTemplates = await getPrintTemplatesForDoc(context.storeId, "return");

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {ret.status !== "cancelled" && <ReturnActions returnId={ret.id} reason={ret.reason} note={ret.note} />}
      <PrintTemplateMenu
        baseHref={`/returns/${ret.id}/print`}
        templates={printTemplates}
        label={t("returns.print")}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          modalActionSizeClassName,
          "min-w-11 lg:min-w-0",
        )}
      />
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

/** NativeReturnDetailView pushed on phones: header card, info rows, items, note and total refund. */
export async function ReturnDetailMobile({ ret }: { ret: ReturnDetail }) {
  const t = await getTranslations();
  const m = await getTranslations("mobile.returns");
  const cancelled = ret.status === "cancelled";
  const card = "rounded-[16px] bg-surface";
  const info = (label: string, value: ReactNode) => (
    <div className="flex items-baseline gap-3 py-2 text-[15px]">
      <span className="shrink-0 text-ios-label-secondary">{label}</span>
      <span className="min-w-0 flex-1 text-right [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
  return (
    <ReturnMobileScreen
      title={ret.code}
      actions={<ReturnActions returnId={ret.id} reason={ret.reason} note={ret.note} variant="menu" cancellable={!cancelled} printHref={`/returns/${ret.id}/print`} />}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <div className={cn(card, "space-y-2.5 p-4")}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[22px] font-bold [overflow-wrap:anywhere]">{ret.code}</div>
              <div className="mt-1 text-ios-label-secondary">{ret.customerName ?? t("orders.walkIn")}</div>
            </div>
            <div className="shrink-0 text-[20px] font-bold tabular-nums text-ios-red">{formatCurrency(Number(ret.totalRefund))}</div>
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span className={cn("font-semibold", cancelled ? "text-ios-red" : "text-ios-green")}>{t(`returns.status.${ret.status}` as never)}</span>
            <span className="text-ios-label-tertiary">·</span>
            <span className="text-ios-label-secondary">{formatDate(ret.createdAt)}</span>
          </div>
        </div>
        <div className={cn(card, "px-4 py-1.5")}>
          {info(m("status"), t(`returns.status.${ret.status}` as never))}
          {info(m("sourceInvoice"), ret.orderId && ret.orderCode ? <OrderDetailLink orderId={ret.orderId} className="text-ios-accent">{ret.orderCode}</OrderDetailLink> : "—")}
          {info(m("reason"), ret.reason ? t(`returns.reasons.${ret.reason}` as never) : "—")}
          {info(m("refundMethod"), t(`returns.refundMethods.${ret.refundMethod}`))}
          {info(m("createdBy"), ret.createdByName ?? "—")}
          {info(m("phone"), ret.customerPhone ?? "—")}
          {info(m("warehouse"), ret.warehouseName ?? "—")}
        </div>
        <div className={cn(card, "p-4")}>
          <h3 className="pb-2 text-[17px] font-semibold">{m("items")}</h3>
          {ret.items.length === 0 && <p className="py-2.5 text-ios-label-secondary">{m("noItems")}</p>}
          <div className="divide-y divide-border">
            {ret.items.map((item) => {
              const pricing = returnLinePricing(item);
              const discount = pricing.lineDiscount * Number(item.quantity);
              return (
                <div key={item.id} className="space-y-1.5 py-2.5">
                  <div className="text-[15px] font-semibold">{productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })}</div>
                  <div className="flex items-baseline gap-2.5">
                    <span className={cn("text-[12px]", item.restock ? "text-ios-green" : "text-ios-red")}>{m(item.restock ? "restockYes" : "restockNo")}</span>
                    <span className="min-w-0 flex-1 text-right text-[12px] text-ios-label-secondary">
                      <span className="block">{formatNumber(Number(item.quantity))} {item.unitName} × {formatCurrency(pricing.unitPrice)}</span>
                      {discount > 0 && <span className="block text-[11px]">{m("discount")}: {pricing.lineDiscountMode === "pct" ? `${formatNumber(pricing.lineDiscountValue)}% · ` : ""}{formatCurrency(discount)}</span>}
                      <span className="block text-[11px]">{m("unitAfterDiscount")}: {formatCurrency(pricing.netUnitPrice)}</span>
                    </span>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums">{formatCurrency(Number(item.total))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {ret.note && (
          <div className={cn(card, "space-y-1.5 p-4")}>
            <h3 className="text-[17px] font-semibold">{m("note")}</h3>
            <p className="text-ios-label-secondary">{ret.note}</p>
          </div>
        )}
        <div className={cn(card, "flex items-center justify-between p-4")}>
          <span className="font-semibold">{m("totalRefund")}</span>
          <span className="text-[22px] font-bold tabular-nums text-ios-red">{formatCurrency(Number(ret.totalRefund))}</span>
        </div>
      </div>
    </ReturnMobileScreen>
  );
}
