import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ExternalLink } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { OrderDetail } from "@/lib/data/orders";
import { OrderStatusBadge, PaymentStatusBadge } from "../status-badges";
import { OrderActions, PaymentForm } from "./order-actions";
import { EInvoiceForm } from "./einvoice-form";
import { buttonVariants } from "@/components/ui/button-variants";

type EInvoiceSummary = {
  id: string;
  status: string;
  number: string | null;
  serial: string;
  buyerName: string;
  vatRate: string | number;
  vatAmount: string | number;
} | null | undefined;

export async function OrderDetailPanel({
  order,
  einvoice,
  compact = false,
  showOpenAction = false,
}: {
  order: OrderDetail;
  einvoice?: EInvoiceSummary;
  compact?: boolean;
  showOpenAction?: boolean;
}) {
  const t = await getTranslations();
  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);
  const cancelled = order.status === "cancelled" || order.status === "merged";
  const posSourceHref = (mode: "edit" | "copy") => {
    const sp = new URLSearchParams({
      sourceMode: mode,
      sourceOrderId: order.id,
      sourceCode: order.code,
      sourceSaleTime: formatDate(order.createdAt),
    });
    return `${Routes.POS}?${sp.toString()}`;
  };
  const openInListHref = `${Routes.Sales}?tab=orders&orderId=${encodeURIComponent(order.id)}&expandedOrder=${encodeURIComponent(order.id)}`;

  return (
    <div className={cn("bg-surface", compact ? "px-4 py-4" : "space-y-4")}>
      <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", compact && "mb-4")}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{order.customerName ?? t("orders.walkIn")}</h2>
            <span className="text-sm font-semibold text-slate-500">{order.code}</span>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            {showOpenAction && (
              <Link href={openInListHref} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:underline">
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
            <div className="overflow-x-auto">
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
                        {item.productName}
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

          {order.payments.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2 text-sm font-semibold">{t("orders.detail.payments")}</div>
              <div className="overflow-x-auto">
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
              <div className="overflow-x-auto">
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
                          <Link href={`/returns/${row.id}/print`} className="text-xs font-medium text-primary-600 hover:underline">{t("print.printBtn")}</Link>
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
                  <Link href={Routes.customer(order.customerId)} className="font-medium text-primary-600 hover:underline">{order.customerName}</Link>
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
            <InfoLine label={t("pos.subtotal")} value={formatCurrency(Number(order.subtotal))} />
            <InfoLine label={t("pos.discount")} value={formatCurrency(Number(order.discount))} />
            <InfoLine label={t("pos.tax")} value={formatCurrency(Number(order.tax))} />
            <InfoLine label={t("pos.shipping")} value={formatCurrency(Number(order.shippingFee))} />
            <InfoLine label={t("pos.total")} value={formatCurrency(total)} valueClassName="text-base text-primary-600" strong />
            <InfoLine label={t("orders.detail.remaining")} value={formatCurrency(remaining)} valueClassName={remaining > 0 ? "text-er" : "text-ok"} strong />
          </div>

          {order.status === "completed" && (
            <div className="space-y-2 rounded-lg border border-border-soft p-3">
              <div className="font-semibold">{t("einvoice.title")}</div>
              {einvoice ? (
                <>
                  <InfoLine label={t("einvoice.cols.number")} value={`${einvoice.serial} · ${einvoice.number ?? "—"}`} strong />
                  <InfoLine label={t("einvoice.cols.buyer")} value={einvoice.buyerName} />
                  <InfoLine label={`VAT ${Number(einvoice.vatRate)}%`} value={formatCurrency(Number(einvoice.vatAmount))} />
                </>
              ) : (
                <EInvoiceForm orderId={order.id} defaultBuyer={order.customerName ?? ""} />
              )}
            </div>
          )}
        </div>
      </div>

      {!cancelled && remaining > 0 && <PaymentForm orderId={order.id} remaining={remaining} />}

      <div className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {!cancelled && <OrderActions orderId={order.id} />}
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <Link href={`${Routes.order(order.id)}/print`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
            {t("print.printBtn")}
          </Link>
          {(order.status === "completed" || order.status === "quote") && order.returns.length === 0 && (
            <Link href={posSourceHref("edit")} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-9")}>
              {t("orderEdit.action")}
            </Link>
          )}
          {!cancelled && (
            <Link href={posSourceHref("copy")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
              {t("pos.modes.copyShort")}
            </Link>
          )}
          {order.status === "completed" && (
            <Link href={`${Routes.order(order.id)}/return`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
              {t("returns.action")}
            </Link>
          )}
          {showOpenAction && (
            <Link href={openInListHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-9")}>
              Mở phiếu
            </Link>
          )}
        </div>
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
