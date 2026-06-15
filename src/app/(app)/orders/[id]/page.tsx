import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { getOrder } from "@/lib/data/orders";
import { OrderStatusBadge, PaymentStatusBadge } from "../status-badges";
import { OrderActions, PaymentForm } from "./order-actions";
import { EInvoiceForm } from "./einvoice-form";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  const [einvoice] = await db.select().from(einvoices).where(eq(einvoices.orderId, id)).limit(1);

  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);
  // merged: đơn gốc đã gộp — khóa mọi thao tác như đơn hủy
  const cancelled = order.status === "cancelled" || order.status === "merged";

  return (
    <div className="p-6 max-w-5xl">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <Link href={Routes.Orders} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-[17px] font-bold">{order.code}</h1>
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`${Routes.order(order.id)}/print`}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-surface-2"
          >
            🖨 {t("print.printBtn")}
          </Link>
          {(order.status === "completed" || order.status === "quote") && order.returns.length === 0 && (
            <Link
              href={`${Routes.order(order.id)}/edit`}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-surface-2"
            >
              ✏️ {t("orderEdit.action")}
            </Link>
          )}
          {order.status === "completed" && (
            <Link
              href={`${Routes.order(order.id)}/return`}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-surface-2"
            >
              ↩ {t("returns.action")}
            </Link>
          )}
          {!cancelled && <OrderActions orderId={order.id} />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          {/* items */}
          <div className="bg-surface border border-border rounded-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-semibold text-sm">
              {t("orders.detail.items")} ({order.items.length})
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.unit")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.qty")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.unitPrice")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3 font-medium">
                      {i.productName}
                      {(order.returnedByItem[i.id] ?? 0) > 0 && (
                        <span className="ml-2 text-xs font-normal text-warn">
                          ↩ {t("returns.returnedQty", { qty: formatNumber(order.returnedByItem[i.id]), unit: i.unitName })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{i.unitName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(Number(i.quantity))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(i.unitPrice))}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(i.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-border text-sm space-y-1.5">
              <div className="flex justify-between text-slate-500"><span>{t("pos.subtotal")}</span><span className="tabular-nums">{formatCurrency(Number(order.subtotal))}</span></div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-slate-500"><span>{t("pos.discount")}</span><span className="tabular-nums text-ok">− {formatCurrency(Number(order.discount))}</span></div>
              )}
              {Number(order.shippingFee) > 0 && (
                <div className="flex justify-between text-slate-500"><span>{t("pos.shipping")}</span><span className="tabular-nums">{formatCurrency(Number(order.shippingFee))}</span></div>
              )}
              <div className="flex justify-between font-semibold text-base pt-1">
                <span>{t("pos.total")}</span><span className="text-primary-600 tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* payments */}
          <div className="bg-surface border border-border rounded-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-semibold text-sm">
              {t("orders.detail.payments")}
            </div>
            {order.payments.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">{t("orders.detail.noPayments")}</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border-soft">
                  {order.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-3">{t(`pos.payMethods.${p.method}` as never)}</td>
                      <td className="px-4 py-3 text-slate-500">{p.note ?? ""}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-ok">+ {formatCurrency(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="px-4 py-3 border-t border-border text-sm flex justify-between">
              <span className="text-slate-500">{t("orders.detail.remaining")}</span>
              <span className={cn("font-semibold tabular-nums", remaining > 0 ? "text-er" : "text-ok")}>
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>

          {!cancelled && remaining > 0 && <PaymentForm orderId={order.id} remaining={remaining} />}

          {/* returns */}
          {order.returns.length > 0 && (
            <div className="bg-surface border border-border rounded-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border font-semibold text-sm">
                {t("returns.sectionTitle")} ({order.returns.length})
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border-soft">
                  {order.returns.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium">{r.code}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{t(`returns.reasons.${r.reason}` as never)}</td>
                      <td className="px-4 py-3">{t(`returns.refundMethods.${r.refundMethod}` as never)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-er">− {formatCurrency(Number(r.totalRefund))}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/returns/${r.id}/print`} className="text-xs font-medium text-primary-600 hover:underline">🖨 {t("print.printBtn")}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* sidebar */}
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-2">
            <h2 className="font-semibold mb-1">{t("orders.detail.customer")}</h2>
            {order.customerId ? (
              <>
                <div className="flex justify-between"><span className="text-slate-500">{t("orders.cols.customer")}</span>
                  <Link href={Routes.customer(order.customerId)} className="font-medium text-primary-600 hover:underline">{order.customerName}</Link></div>
                {order.customerPhone && <div className="flex justify-between"><span className="text-slate-500">{t("customers.cols.phone")}</span><span>{order.customerPhone}</span></div>}
                <div className="flex justify-between"><span className="text-slate-500">{t("customers.cols.type")}</span><span>{t(`customers.types.${order.customerType}` as never)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("customers.cols.debt")}</span>
                  <span className={cn("tabular-nums font-medium", Number(order.customerDebt) > 0 && "text-er")}>{formatCurrency(Number(order.customerDebt ?? 0))}</span></div>
              </>
            ) : (
              <p className="text-slate-400">{t("orders.walkIn")}</p>
            )}
          </div>

          {order.status === "completed" && (
            <div className="bg-surface border border-border rounded-card p-4 text-sm">
              <h2 className="font-semibold mb-2">{t("einvoice.title")}</h2>
              {einvoice ? (
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">{t("einvoice.cols.number")}</span><b>{einvoice.serial} · {einvoice.number}</b></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("einvoice.cols.buyer")}</span><span>{einvoice.buyerName}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">VAT {Number(einvoice.vatRate)}%</span><span className="tabular-nums">{formatCurrency(Number(einvoice.vatAmount))}</span></div>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-ok-soft text-ok mt-1">{t("einvoice.issued")}</span>
                </div>
              ) : (
                <EInvoiceForm orderId={order.id} defaultBuyer={order.customerName ?? ""} />
              )}
            </div>
          )}

          <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-2">
            <h2 className="font-semibold mb-1">{t("orders.detail.info")}</h2>
            <div className="flex justify-between"><span className="text-slate-500">{t("orders.cols.date")}</span><span>{formatDate(order.createdAt)}</span></div>
            {order.projectName && <div className="flex justify-between"><span className="text-slate-500">{t("orders.cols.project")}</span><span className="text-right">{order.projectName}</span></div>}
            {order.warehouseName && <div className="flex justify-between"><span className="text-slate-500">{t("orders.detail.warehouse")}</span><span>{order.warehouseName}</span></div>}
            {order.sellerName && <div className="flex justify-between"><span className="text-slate-500">{t("orders.detail.seller")}</span><span>{order.sellerName}</span></div>}
            {order.note && <p className="text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">{order.note}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
