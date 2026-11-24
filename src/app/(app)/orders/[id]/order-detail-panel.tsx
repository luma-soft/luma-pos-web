import Link from "next/link";
import { FitText } from "@/components/fit-text";
import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { OrderDetail } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { getStoreSettings } from "@/lib/data/settings";
import { getPrintTemplate, getPrintTemplatesForDoc } from "@/lib/print/template";
import type { ShareablePrintDocType } from "@/lib/print/share-document";
import { OrderStatusBadge, PaymentStatusBadge } from "../status-badges";
import { CreateInvoiceFromDraftButton, OrderActions, PaymentForm, SendOrderZaloButton } from "./order-actions";
import { SharePrintDocButton } from "./share-print-doc-button";
import { buttonVariants, modalActionSizeClassName } from "@/components/ui/button-variants";
import { OrderDetailActionGroup } from "@/components/order-detail-action-group";
import { DisabledEditTooltip } from "@/components/disabled-edit-tooltip";
import { ProfitVisibility } from "@/components/profit-visibility";
import { OrderProductLink } from "@/components/order-product-link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { productDisplayName } from "@/lib/products/variant-presentation";
import { BookingCreateOrderButton, QuoteDeleteButton } from "../../quotes/quote-actions";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import { requireStoreContext } from "@/lib/auth/store-context";
import { MobileDetailNav } from "@/components/mobile-detail-nav";
import { mobileDocumentTimestamp } from "@/app/(app)/sales/tabs/mobile-document-day";
import { Package } from "lucide-react";

export async function OrderDetailPanel({
  order,
  compact = false,
  showOpenAction = false,
}: {
  order: OrderDetail;
  compact?: boolean;
  showOpenAction?: boolean;
}) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const context = await requireStoreContext();
  const store = await getStoreSettings(context.storeId);
  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);
  const taxAmount = Number(order.tax);
  const subtotalAfterDiscount = Math.max(0, Number(order.subtotal) - Number(order.discount));
  const taxableBase = Math.max(0, subtotalAfterDiscount - (store.prefs.tax.priceIncludesTax ? taxAmount : 0));
  const effectiveTaxRate = taxableBase > 0
    ? Math.round((taxAmount / taxableBase) * 10_000) / 100
    : null;
  const isQuote = order.status === "quote";
  const isBooking = order.status === "confirmed";
  const cancelled = order.status === "cancelled" || order.status === "merged";
  const mergedSource = order.status === "merged"
    || (cancelled && Boolean(order.systemNote?.startsWith("Đã gộp vào ")));
  const editableDraft = order.status === "draft"
    && order.documentType === "sale"
    && Number(order.amountPaid) === 0
    && order.payments.length === 0
    && order.returns.length === 0;
  const canCreateInvoiceFromDraft = editableDraft && order.items.length > 0;
  const sourceKind = isQuote ? "quote" : isBooking ? "booking" : "invoice";
  const shareDocType: ShareablePrintDocType | null = cancelled
    ? null
    : order.status === "completed"
      ? "order"
      : isQuote
        ? "quote"
        : isBooking
          ? "booking"
          : null;
  const printDocType = isQuote ? "quote" : isBooking ? "booking" : "order";
  const [shareTemplate, printTemplates, returnPrintTemplates] = await Promise.all([
    shareDocType ? getPrintTemplate(context.storeId, shareDocType) : Promise.resolve(null),
    getPrintTemplatesForDoc(context.storeId, printDocType),
    getPrintTemplatesForDoc(context.storeId, "return"),
  ]);
  const shareHref = shareTemplate
    ? `${Routes.order(order.id)}/print?${new URLSearchParams({ templateId: shareTemplate.id, size: shareTemplate.paperDefault }).toString()}`
    : null;
  const posSourceHref = (mode: "edit" | "draft_edit" | "copy" | "return", sourceKindOverride?: string) => {
    const sp = new URLSearchParams({
      sourceMode: mode,
      sourceKind: sourceKindOverride ?? sourceKind,
      sourceOrderId: order.id,
      sourceCode: order.code,
      sourceSaleTime: formatDate(order.createdAt),
    });
    return `${Routes.POS}?${sp.toString()}`;
  };
  const openInListHref = Routes.salesOrder(order.id, order.status);
  const canSendZalo = Boolean(
    store.prefs.zalo.enabled
    && store.prefs.zalo.accessTokenSet
    && (store.prefs.zalo.deliveryMode === "oa"
      ? order.customerZaloUserId
      : store.prefs.zalo.invoiceTemplateId && order.customerPhone)
  );

  const secondaryActions = (
    <OrderDetailActionGroup label={t("common.actions")}>
      {isQuote && !cancelled ? <QuoteDeleteButton quoteId={order.id} /> : !cancelled && <OrderActions orderId={order.id} />}
      {!isQuote && canSendZalo && <SendOrderZaloButton orderId={order.id} />}
    </OrderDetailActionGroup>
  );
  const primaryActions = (
      <OrderDetailActionGroup label={t("common.actions")} alignEnd>
        {canCreateInvoiceFromDraft && (order.isPosCartDraft || !order.warehouseId ? (
          <Link
            href={posSourceHref("edit", "invoice")}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "default", size: "sm" }), modalActionSizeClassName)}
          >
            {t("orders.createInvoiceFromDraft")}
          </Link>
        ) : <CreateInvoiceFromDraftButton orderId={order.id} />)}
        {!isQuote && !cancelled && remaining > 0 && <PaymentForm key={`${order.id}:${remaining}`} orderId={order.id} remaining={remaining} />}
        {isQuote && !order.hasCreatedOrder && (
          <Link href={posSourceHref("copy", "invoice")} className={cn(buttonVariants({ variant: "default", size: "sm" }), modalActionSizeClassName)}>
            {t("quotes.convert")}
          </Link>
        )}
        {isBooking && !cancelled && <BookingCreateOrderButton bookingId={order.id} />}
        {shareDocType && shareHref && <SharePrintDocButton href={shareHref} code={order.code} docType={shareDocType} />}
        <PrintTemplateMenu
          baseHref={`${Routes.order(order.id)}/print`}
          templates={printTemplates}
          label={t("print.printBtn")}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName)}
        />
        {(order.status === "completed" || order.status === "quote" || order.status === "confirmed" || (order.status === "returned" && order.returns.length > 0) || editableDraft) && (
          order.returns.length > 0 ? (
            <DisabledEditTooltip
              reason={t("orderEdit.errors.hasReturns")}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName, "bg-white dark:bg-surface")}
            >
              {isBooking ? t("bookings.edit") : t("orderEdit.action")}
            </DisabledEditTooltip>
          ) : (
            <Link href={posSourceHref(editableDraft ? "draft_edit" : "edit")} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName, "bg-white dark:bg-surface")}>
              {isQuote
                ? t("quotes.edit")
                : isBooking
                  ? t("bookings.edit")
                  : editableDraft
                    ? t("orderEdit.editDraftAction")
                    : t("orderEdit.action")}
            </Link>
          )
        )}
        {!cancelled && (
          <Link href={posSourceHref("copy")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName)}>
            {t("pos.modes.copyShort")}
          </Link>
        )}
        {order.status === "completed" && (
          <Link href={posSourceHref("return")} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName)}>
            {t("returns.action")}
          </Link>
        )}
        {showOpenAction && (
          <Link href={openInListHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), modalActionSizeClassName)}>
            Mở phiếu
          </Link>
        )}
      </OrderDetailActionGroup>
  );
  const actionGroups = <>{secondaryActions}{primaryActions}</>;
  // The native "…" menu lists everyday actions first and destructive ones (cancel) last.
  const mobileActions = <>{primaryActions}{secondaryActions}</>;
  const lastPaymentMethod = order.payments.length > 0 ? order.payments[order.payments.length - 1]?.method : null;

  return (
    <div className={cn("bg-surface max-lg:bg-canvas", compact && "flex h-full min-h-0 flex-col")}>
      <div className={cn(compact ? "min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 max-lg:p-0" : "space-y-4")}>
      <MobileDetailNav title={order.code} actions={mobileActions} />
      {/* NativeInvoiceDetailView: summary, products, payment info, totals, history and note cards. */}
      <div className="space-y-ios-section px-ios-inset pb-8 pt-3 lg:hidden">
        <section className="rounded-[22px] bg-surface p-ios-inset">
          <FitText className="block truncate text-[22px] font-bold leading-7" minScale={0.7}>{order.code}</FitText>
          <div className="mt-1.5 text-[17px]">
            <PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} openInCurrentTab className="!min-h-0 text-ios-accent" />
          </div>
          <div className="mt-1.5 text-[13px] text-ios-label-secondary">{mobileDocumentTimestamp(order.createdAt, locale)}</div>
          <div className="mt-3 flex items-center gap-1.5">
            {/* iOS status capsules: full labels, 15pt semibold, tinted. */}
            <span className={cn("inline-flex h-[25px] shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold", order.status === "completed" ? "bg-ios-green/12 text-ios-green" : order.status === "cancelled" ? "bg-ios-red/12 text-ios-red" : order.status === "returned" ? "bg-ios-orange/12 text-ios-orange" : "bg-ios-accent/12 text-ios-accent")}>
              {t(`mobile.orderDetail.status.${["completed", "cancelled", "returned", "draft", "quote", "confirmed", "delivering", "merged"].includes(order.status) ? order.status : "draft"}`)}
            </span>
            {!isQuote && !cancelled && (
              <span className={cn("inline-flex h-[25px] min-w-0 items-center truncate rounded-full px-2.5 text-[12px] font-semibold", order.paymentStatus === "paid" ? "bg-ios-green/12 text-ios-green" : "bg-ios-orange/12 text-ios-orange")}>
                {t(`mobile.orderDetail.payment.${order.paymentStatus === "paid" ? "paid" : order.paymentStatus === "partial" || order.paymentStatus === "deposit" ? "partial" : "unpaid"}`)}
              </span>
            )}
            <FitText className="ml-auto block min-w-0 shrink truncate text-right text-[20px] font-bold tabular-nums text-ios-accent" minScale={0.7}>{formatCurrency(total)}</FitText>
          </div>
          {(mergedSource && order.replacedByOrderId) || order.returns.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-3 text-[15px] font-semibold">
              {mergedSource && order.replacedByOrderId && <Link href={Routes.order(order.replacedByOrderId)} className="text-ios-accent">Xem đơn gộp</Link>}
              {order.returns.length > 0 && <Link href="#order-returns-mobile" className="text-ios-orange">Đã trả hàng ({order.returns.length})</Link>}
            </div>
          ) : null}
        </section>

        <section className="rounded-[22px] bg-surface p-ios-inset">
          <h2 className="text-[17px] font-bold">{t("mobile.orderDetail.products", { count: order.items.length })}</h2>
          <div className="mt-2 divide-y divide-border">
            {order.items.map((item) => {
              const pricing = readOrderLinePricing(item);
              const image = Array.isArray(item.productImageUrls) && typeof item.productImageUrls[0] === "string" ? item.productImageUrls[0] : null;
              return (
                <div key={item.id} className="flex items-start gap-3 py-3">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" className="size-16 shrink-0 rounded-[14px] border border-border bg-white object-cover" />
                  ) : (
                    <span className="grid size-16 shrink-0 place-items-center rounded-[14px] border border-border bg-black/[0.05] text-ios-label-tertiary dark:bg-white/10" aria-hidden="true">
                      <Package className="size-7" strokeWidth={1.6} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-5 [&_a]:!min-h-0 [&_a]:!text-ios-label">
                      <OrderProductLink productId={item.productId} productName={productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })} />
                    </div>
                    <div className="mt-1 text-[13px] text-ios-label-secondary">{formatNumber(Number(item.quantity))} {item.unitName} · {formatCurrency(pricing.unitPrice)}</div>
                    {pricing.discount > 0 && (
                      <div className="mt-1 text-[11px] text-ios-label-secondary">{t("mobile.orderDetail.discount", { amount: `${pricing.lineDiscountMode === "pct" ? `${formatNumber(pricing.lineDiscountValue)}% · ` : ""}${formatCurrency(pricing.lineDiscount)}` })}</div>
                    )}
                    <div className="mt-1 text-[11px] text-ios-label-secondary">{t("mobile.orderDetail.netUnitPrice", { amount: formatCurrency(pricing.netUnitPrice) })}</div>
                    {item.priceBookName && <div className="mt-1 text-[13px] text-ios-label-secondary">{item.priceBookName}</div>}
                    {(order.returnedByItem[item.id] ?? 0) > 0 && (
                      <div className="mt-1 text-[13px] text-ios-orange">{t("returns.returnedQty", { qty: formatNumber(order.returnedByItem[item.id]), unit: item.unitName })}</div>
                    )}
                  </div>
                  <FitText className="block max-w-[45%] shrink-0 truncate text-right text-[15px] tabular-nums" minScale={0.75}>{formatCurrency(Number(item.total))}</FitText>
                </div>
              );
            })}
          </div>
        </section>

        {!isQuote && (
          <section className="space-y-2.5 rounded-[22px] bg-surface p-ios-inset text-[15px]">
            <h2 className="text-[17px] font-bold">{t("mobile.orderDetail.paymentInfo")}</h2>
            <MobileInfoRow label={t("orders.detail.paid")} value={formatCurrency(paid)} />
            <MobileInfoRow label={t("mobile.orderDetail.paymentMethod")} value={lastPaymentMethod ? t(`pos.payMethods.${lastPaymentMethod}` as never) : t("mobile.orderDetail.notSpecified")} />
          </section>
        )}

        <section className="space-y-2.5 rounded-[22px] bg-surface p-ios-inset text-[15px]">
          <h2 className="text-[17px] font-bold">{t("mobile.orderDetail.totals")}</h2>
          <MobileInfoRow label={t("pos.subtotal")} value={formatCurrency(Number(order.subtotal))} />
          <MobileInfoRow label={t("pos.discount")} value={formatCurrency(Number(order.discount))} />
          <MobileInfoRow label={effectiveTaxRate === null ? t("pos.tax") : t("mobile.orderDetail.taxRate", { rate: formatNumber(effectiveTaxRate) })} value={formatCurrency(taxAmount)} />
          <MobileInfoRow label={t("mobile.orderDetail.shipping")} value={formatCurrency(Number(order.shippingFee))} />
          <div className="border-t border-border pt-2.5">
            <MobileInfoRow label={t("pos.total")} value={formatCurrency(total)} valueClassName="font-semibold text-ios-accent" />
          </div>
          {!isQuote && !mergedSource && <MobileInfoRow label={t("orders.detail.paid")} value={formatCurrency(paid)} valueClassName="font-semibold text-ios-green" />}
          {!isQuote && !mergedSource && <MobileInfoRow label={t("mobile.orderDetail.remaining")} value={formatCurrency(remaining)} valueClassName={remaining > 0 ? undefined : "text-ios-green"} />}
          {order.grossProfit !== null && <ProfitVisibility label={t("dashboard.grossProfit")} value={Number(order.grossProfit)} className="pt-1 [&>div:first-child]:text-[17px]" />}
        </section>

        {order.returns.length > 0 && (
          <section id="order-returns-mobile" className="rounded-[22px] bg-surface p-ios-inset">
            <h2 className="text-[17px] font-bold">{t("returns.sectionTitle")} ({order.returns.length})</h2>
            <div className="mt-2 divide-y divide-border">
              {order.returns.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 py-3 text-[15px]">
                  <div className="min-w-0">
                    <Link href={`/sales?tab=returns&expandedReturn=${encodeURIComponent(row.id)}`} className="font-semibold text-ios-accent">{row.code}</Link>
                    <div className="mt-0.5 text-[13px] text-ios-label-secondary">{mobileDocumentTimestamp(row.createdAt, locale)} · {t(`returns.reasons.${row.reason}` as never)}</div>
                  </div>
                  <FitText className={cn("block max-w-[50%] shrink-0 truncate font-semibold tabular-nums", row.status === "cancelled" ? "text-ios-label-tertiary line-through" : "text-ios-red")} minScale={0.75}>- {formatCurrency(Number(row.totalRefund))}</FitText>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[22px] bg-surface p-ios-inset">
          <h2 className="text-[17px] font-bold">{t("mobile.orderDetail.paymentHistory")}</h2>
          {isQuote || order.payments.length === 0 ? (
            <p className="mt-2 text-[15px] text-ios-label-secondary">{t("mobile.orderDetail.noPayments")}</p>
          ) : (
            <div className="mt-1 divide-y divide-border">
              {order.payments.map((payment) => (
                <div key={payment.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[15px]">{t(`pos.payMethods.${payment.method}` as never)}</div>
                    <div className="mt-0.5 text-[13px] text-ios-label-secondary">
                      {[mobileDocumentTimestamp(payment.createdAt, locale), payment.reference, payment.note].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <FitText className="block max-w-[50%] shrink-0 truncate text-[15px] font-semibold tabular-nums text-ios-green" minScale={0.75}>+ {formatCurrency(Number(payment.amount))}</FitText>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <h2 className="text-[17px] font-bold">{t("mobile.orderDetail.note")}</h2>
            <p className={cn("mt-2 whitespace-pre-wrap text-[15px]", !order.note && "text-ios-label-secondary")}>{order.note || t("mobile.orderDetail.noNote")}</p>
            {order.systemNote && <p className="mt-2 whitespace-pre-wrap text-[13px] text-ios-label-secondary">{order.systemNote}</p>}
          </div>
        </section>
      </div>
      <div className="max-lg:hidden">
      <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", compact && "mb-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 max-w-full break-words text-xl font-bold text-slate-900 dark:text-slate-100">
              <PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} className="block whitespace-normal break-words" />
            </h2>
            <span className="text-sm font-semibold text-slate-500">{order.code}</span>
            <OrderStatusBadge status={order.status} />
            {!isQuote && !cancelled && <PaymentStatusBadge status={order.paymentStatus} />}
            {mergedSource && order.replacedByOrderId && (
              <Link href={Routes.order(order.replacedByOrderId)} className="text-xs font-semibold text-primary-600 hover:underline">
                Xem đơn gộp
              </Link>
            )}
            {order.returns.length > 0 && (
              <Link href="#order-returns" className="inline-flex rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn hover:underline">
                Đã trả hàng ({order.returns.length})
              </Link>
            )}
            {showOpenAction && (
              <Link href={openInListHref} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary-600 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:min-h-0 lg:px-0 min-w-11 lg:min-w-0">
                <ExternalLink className="h-4 w-4" />
                Mở phiếu
              </Link>
            )}
          </div>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            <InfoLine label={t("orders.detail.seller")} value={order.sellerName ?? "—"} />
            <InfoLine label={t("orders.cols.date")} value={formatDate(order.createdAt)} />
            <InfoLine label={t("orders.cols.project")} value={order.projectName ?? "—"} />
            <InfoLine label="Bảng giá" value="Bảng giá chung" />
            <InfoLine label={t("customers.cols.phone")} value={order.customerPhone ?? "—"} />
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Điện Nước Kim Khí Hải Đăng
        </div>
      </div>

      <div className={cn("grid grid-cols-1 gap-4", compact ? "xl:grid-cols-[1fr_300px]" : "lg:grid-cols-[1fr_320px]")}>
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="divide-y divide-border-soft lg:hidden">
              {order.items.map((item) => {
                const pricing = readOrderLinePricing(item);
                return (
                <div key={item.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-medium">
                      <OrderProductLink productId={item.productId} productName={productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })} />
                      {item.priceBookName && <div className="mt-1 text-xs font-normal text-slate-500">{item.priceBookName}</div>}
                      {(order.returnedByItem[item.id] ?? 0) > 0 && (
                        <div className="mt-1 text-xs font-normal text-warn">
                          {t("returns.returnedQty", { qty: formatNumber(order.returnedByItem[item.id]), unit: item.unitName })}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 font-semibold tabular-nums">{formatCurrency(Number(item.total))}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{formatNumber(Number(item.quantity))} {item.unitName}</span>
                    <span>× {formatCurrency(pricing.unitPrice)}</span>
                    {pricing.discount > 0 && <span>{t("orders.cols.discount")}: {pricing.lineDiscountMode === "pct" && `${formatNumber(pricing.lineDiscountValue)}% · `}{formatCurrency(pricing.lineDiscount)}</span>}
                    <span>{t("orders.cols.unitPriceAfterDiscount")}: {formatCurrency(pricing.netUnitPrice)}</span>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[860px] text-sm">
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
                  {order.items.map((item) => {
                    const pricing = readOrderLinePricing(item);
                    return (
                    <tr key={item.id}>
                      <td className="px-3 py-3 font-medium">
                        <OrderProductLink productId={item.productId} productName={productDisplayName({ name: item.productName, variantName: item.productVariantName, specs: item.productSpecs })} />
                        {item.priceBookName && <div className="mt-1 text-xs font-normal text-slate-500">{item.priceBookName}</div>}
                        {(order.returnedByItem[item.id] ?? 0) > 0 && (
                          <span className="ml-2 text-xs font-normal text-warn">
                            {t("returns.returnedQty", { qty: formatNumber(order.returnedByItem[item.id]), unit: item.unitName })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{item.unitName}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.unitPrice)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">{pricing.discount > 0 ? <>{pricing.lineDiscountMode === "pct" && <div>{formatNumber(pricing.lineDiscountValue)}%</div>}{formatCurrency(pricing.lineDiscount)}</> : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(pricing.netUnitPrice)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border px-4 py-3 text-sm">
            <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">Ghi chú người dùng</div>
            <div className={order.note ? "whitespace-pre-wrap text-slate-700 dark:text-slate-200" : "text-slate-400"}>
              {order.note || "Không có ghi chú"}
            </div>
          </div>
          {order.systemNote && (
            <div className="rounded-lg border border-border px-4 py-3 text-sm">
              <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">Thông tin hệ thống</div>
              <div className="whitespace-pre-wrap text-slate-500">{order.systemNote}</div>
            </div>
          )}

          {!isQuote && order.payments.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">{t("orders.detail.payments")}</div>
              <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="order-payments">
                {order.payments.map((payment) => (
                  <div key={payment.id} className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{t(`pos.payMethods.${payment.method}` as never)}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{formatDate(payment.createdAt)}</div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums text-ok">+ {formatCurrency(Number(payment.amount))}</div>
                    </div>
                    {(payment.reference || payment.note) && (
                      <p className="break-words text-xs text-slate-500">
                        {[payment.reference, payment.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[620px] text-sm">
                  <tbody className="divide-y divide-border-soft">
                    {order.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-500">{formatDate(payment.createdAt)}</td>
                        <td className="px-3 py-3">{t(`pos.payMethods.${payment.method}` as never)}</td>
                        <td className="px-3 py-3 text-slate-500">
                          {[payment.reference, payment.note].filter(Boolean).join(" · ")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold text-ok">+ {formatCurrency(Number(payment.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {order.returns.length > 0 && (
            <div id="order-returns" className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">{t("returns.sectionTitle")} ({order.returns.length})</div>
              <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="order-returns">
                {order.returns.map((row) => (
                  <div key={row.id} className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/sales?tab=returns&expandedReturn=${encodeURIComponent(row.id)}`} className="font-semibold text-primary-600 hover:underline">{row.code}</Link>
                          {row.status === "cancelled" && <span className="rounded-full bg-er-soft px-2 py-0.5 text-[11px] font-semibold text-er">{t("returns.status.cancelled")}</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{formatDate(row.createdAt)}</div>
                      </div>
                      <div className={cn("shrink-0 font-semibold tabular-nums", row.status === "cancelled" ? "text-slate-400 line-through" : "text-er")}>- {formatCurrency(Number(row.totalRefund))}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span className="break-words">{t(`returns.reasons.${row.reason}` as never)}</span>
                      <span className="break-words text-right">{t(`returns.refundMethods.${row.refundMethod}` as never)}</span>
                    </div>
                    <PrintTemplateMenu
                      baseHref={`/returns/${row.id}/print`}
                      templates={returnPrintTemplates}
                      label={t("print.printBtn")}
                      className="min-h-11 min-w-11 justify-center rounded-lg px-2 text-xs font-semibold text-primary-600 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[760px] text-sm">
                  <tbody className="divide-y divide-border-soft">
                    {order.returns.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-3 font-medium">
                          <Link href={`/sales?tab=returns&expandedReturn=${encodeURIComponent(row.id)}`} className="text-primary-600 hover:underline">{row.code}</Link>
                          {row.status === "cancelled" && <span className="ml-2 rounded-full bg-er-soft px-2 py-0.5 text-[11px] font-semibold text-er">{t("returns.status.cancelled")}</span>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="px-3 py-3 text-slate-500">{t(`returns.reasons.${row.reason}` as never)}</td>
                        <td className="px-3 py-3">{t(`returns.refundMethods.${row.refundMethod}` as never)}</td>
                        <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", row.status === "cancelled" ? "text-slate-400 line-through" : "text-er")}>- {formatCurrency(Number(row.totalRefund))}</td>
                        <td className="px-3 py-3 text-right">
                          <PrintTemplateMenu baseHref={`/returns/${row.id}/print`} templates={returnPrintTemplates} label={t("print.printBtn")} className="text-xs font-medium text-primary-600 hover:underline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("orders.detail.customer")}</div>
            {order.customerId ? (
              <>
                <InfoLine label={t("orders.cols.customer")}>
                  <PartnerDetailLink kind="customer" partnerId={order.customerId} name={order.customerName ?? t("orders.walkIn")} className="font-medium" />
                </InfoLine>
                <InfoLine label={t("customers.cols.phone")} value={order.customerPhone ?? "—"} />
                <InfoLine label={t("customers.cols.debt")} value={formatCurrency(Number(order.customerDebt ?? 0))} valueClassName={Number(order.customerDebt ?? 0) > 0 ? "text-er" : "text-slate-500"} strong />
              </>
            ) : (
              <p className="text-slate-400">{t("orders.walkIn")}</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("orders.detail.info")}</div>
            {order.sourceMode && <InfoLine label="Channel" value={orderChannelLabel(order.sourceMode)} valueClassName={order.sourceMode === "shopee" ? "font-semibold text-warn" : undefined} />}
            {order.sourceSaleTime && <InfoLine label="Source time" value={formatDate(order.sourceSaleTime)} />}
            <InfoLine label={t("pos.subtotal")} value={formatCurrency(Number(order.subtotal))} />
            <InfoLine label={t("pos.discount")} value={formatCurrency(Number(order.discount))} />
            <InfoLine
              label={t("pos.tax")}
              value={`${formatCurrency(taxAmount)}${effectiveTaxRate === null ? "" : ` (${formatNumber(effectiveTaxRate)}%)`}`}
            />
            <InfoLine label={t("pos.shipping")} value={formatCurrency(Number(order.shippingFee))} />
            <InfoLine label={t("pos.total")} value={formatCurrency(total)} valueClassName="text-base text-primary-600" strong />
            {!isQuote && !mergedSource && <InfoLine label={t("orders.detail.paid")} value={formatCurrency(paid)} valueClassName={paid > 0 ? "text-ok" : "text-slate-500"} strong />}
            {!isQuote && !mergedSource && <InfoLine label={t("orders.detail.remaining")} value={formatCurrency(remaining)} valueClassName={remaining > 0 ? "text-er" : "text-ok"} strong />}
            {order.grossProfit !== null && <ProfitVisibility label={t("dashboard.grossProfit")} value={Number(order.grossProfit)} className="border-t border-border-soft pt-2" />}
          </div>

        </div>
      </div>
      </div>

      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-3 border-t border-border-soft max-lg:hidden xl:flex-row xl:items-center xl:justify-between",
          compact ? "bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4" : "mt-4 pt-4",
        )}
      >
        {actionGroups}
      </div>
    </div>
  );
}

function orderChannelLabel(source: string) {
  if (source === "shopee") return "Shopee";
  if (source === "tiktok_shop") return "TikTok Shop";
  if (source === "lazada") return "Lazada";
  if (source === "tiki") return "Tiki";
  return source;
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

function MobileInfoRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-ios-label-secondary">{label}</span>
      <FitText className={cn("block min-w-0 truncate text-right tabular-nums", valueClassName)} minScale={0.75}>{value}</FitText>
    </div>
  );
}
