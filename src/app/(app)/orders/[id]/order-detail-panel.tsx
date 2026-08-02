import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { OrderDetail } from "@/lib/data/orders";
import { getStoreSettings } from "@/lib/data/settings";
import { getPrintTemplate, getPrintTemplatesForDoc } from "@/lib/print/template";
import type { ShareablePrintDocType } from "@/lib/print/share-document";
import { OrderStatusBadge, PaymentStatusBadge } from "../status-badges";
import { OrderActions, PaymentForm, SendOrderZaloButton } from "./order-actions";
import { SharePrintDocButton } from "./share-print-doc-button";
import { buttonVariants } from "@/components/ui/button-variants";
import { OrderDetailActionGroup } from "@/components/order-detail-action-group";
import { OrderProductLink } from "@/components/order-product-link";
import { BookingCreateOrderButton, QuoteDeleteButton } from "../../quotes/quote-actions";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";

export async function OrderDetailPanel({
  order,
  compact = false,
  showOpenAction = false,
}: {
  order: OrderDetail;
  compact?: boolean;
  showOpenAction?: boolean;
}) {
  const t = await getTranslations();
  const store = await getStoreSettings();
  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);
  const isQuote = order.status === "quote";
  const isBooking = order.status === "confirmed";
  const cancelled = order.status === "cancelled" || order.status === "merged";
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
    shareDocType ? getPrintTemplate(shareDocType) : Promise.resolve(null),
    getPrintTemplatesForDoc(printDocType),
    getPrintTemplatesForDoc("return"),
  ]);
  const shareHref = shareTemplate
    ? `${Routes.order(order.id)}/print?${new URLSearchParams({ templateId: shareTemplate.id, size: shareTemplate.paperDefault }).toString()}`
    : null;
  const posSourceHref = (mode: "edit" | "copy" | "return", sourceKindOverride?: string) => {
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

  return (
    <div className={cn("bg-surface", compact && "flex h-full min-h-0 flex-col")}>
      <div className={cn(compact ? "min-h-0 flex-1 overflow-y-auto p-4 sm:p-5" : "space-y-4")}>
      <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", compact && "mb-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{order.customerName ?? t("orders.walkIn")}</h2>
            <span className="text-sm font-semibold text-slate-500">{order.code}</span>
            <OrderStatusBadge status={order.status} />
            {!isQuote && <PaymentStatusBadge status={order.paymentStatus} />}
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
            <InfoLine label={t("purchases.cols.warehouse")} value={order.warehouseName ?? "—"} />
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
              {order.items.map((item) => (
                <div key={item.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-medium">
                      <OrderProductLink productId={item.productId} productName={item.productName} />
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
                    <span>× {formatCurrency(Number(item.unitPrice))}</span>
                    {Number(item.discount) > 0 && <span>{t("orders.cols.discount")}: {formatCurrency(Number(item.discount))}</span>}
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
                    <th className="px-3 py-3 text-right">{t("orders.cols.discount")}</th>
                    <th className="px-3 py-3 text-right">{t("orders.cols.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-3 font-medium">
                        <OrderProductLink productId={item.productId} productName={item.productName} />
                        {(order.returnedByItem[item.id] ?? 0) > 0 && (
                          <span className="ml-2 text-xs font-normal text-warn">
                            {t("returns.returnedQty", { qty: formatNumber(order.returnedByItem[item.id]), unit: item.unitName })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{item.unitName}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitPrice))}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">{Number(item.discount) > 0 ? formatCurrency(Number(item.discount)) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="min-h-[120px] rounded-lg border border-border px-4 py-3 text-sm text-slate-400">
            {order.note || "Ghi chú..."}
          </div>

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
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">{t("returns.sectionTitle")} ({order.returns.length})</div>
              <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="order-returns">
                {order.returns.map((row) => (
                  <div key={row.id} className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{row.code}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{formatDate(row.createdAt)}</div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums text-er">- {formatCurrency(Number(row.totalRefund))}</div>
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
                        <td className="px-3 py-3 font-medium">{row.code}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-500">{formatDate(row.createdAt)}</td>
                        <td className="px-3 py-3 text-slate-500">{t(`returns.reasons.${row.reason}` as never)}</td>
                        <td className="px-3 py-3">{t(`returns.refundMethods.${row.refundMethod}` as never)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold text-er">- {formatCurrency(Number(row.totalRefund))}</td>
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
                  <Link href={Routes.customer(order.customerId)} className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">{order.customerName}</Link>
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
            <InfoLine label={t("pos.tax")} value={formatCurrency(Number(order.tax))} />
            <InfoLine label={t("pos.shipping")} value={formatCurrency(Number(order.shippingFee))} />
            <InfoLine label={t("pos.total")} value={formatCurrency(total)} valueClassName="text-base text-primary-600" strong />
            {!isQuote && <InfoLine label={t("orders.detail.remaining")} value={formatCurrency(remaining)} valueClassName={remaining > 0 ? "text-er" : "text-ok"} strong />}
          </div>

        </div>
      </div>

      {!isQuote && !cancelled && remaining > 0 && <PaymentForm orderId={order.id} remaining={remaining} />}
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-col gap-3 border-t border-border-soft xl:flex-row xl:items-center xl:justify-between",
          compact ? "bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4" : "mt-4 pt-4",
        )}
      >
        <OrderDetailActionGroup label={t("common.actions")}>
          {isQuote && !cancelled ? <QuoteDeleteButton quoteId={order.id} /> : !cancelled && <OrderActions orderId={order.id} />}
          {!isQuote && canSendZalo && <SendOrderZaloButton orderId={order.id} />}
        </OrderDetailActionGroup>
        <OrderDetailActionGroup label={t("common.actions")} alignEnd>
          {isQuote && !order.hasCreatedOrder && (
            <Link href={posSourceHref("copy", "invoice")} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-11 lg:h-9")}>
              {t("quotes.convert")}
            </Link>
          )}
          {isBooking && !cancelled && <BookingCreateOrderButton bookingId={order.id} />}
          {shareDocType && shareHref && <SharePrintDocButton href={shareHref} code={order.code} docType={shareDocType} />}
          <PrintTemplateMenu
            baseHref={`${Routes.order(order.id)}/print`}
            templates={printTemplates}
            label={t("print.printBtn")}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 lg:h-9")}
          />
          {(order.status === "completed" || order.status === "quote" || order.status === "confirmed") && order.returns.length === 0 && (
            <Link href={posSourceHref("edit")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 bg-white dark:bg-surface lg:h-9")}>
              {isQuote ? t("quotes.edit") : isBooking ? t("bookings.edit") : t("orderEdit.action")}
            </Link>
          )}
          {!cancelled && (
            <Link href={posSourceHref("copy")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 lg:h-9")}>
              {t("pos.modes.copyShort")}
            </Link>
          )}
          {order.status === "completed" && (
            <Link href={posSourceHref("return")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 lg:h-9")}>
              {t("returns.action")}
            </Link>
          )}
          {showOpenAction && (
            <Link href={openInListHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-11 lg:h-9")}>
              Mở phiếu
            </Link>
          )}
        </OrderDetailActionGroup>
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
