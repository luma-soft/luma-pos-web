import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { FileCheck2 } from "lucide-react";
import { db } from "@/db";
import { einvoices, orders } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EInvoicesPage() {
  const t = await getTranslations();

  const rows = await db
    .select({
      id: einvoices.id,
      number: einvoices.number,
      serial: einvoices.serial,
      status: einvoices.status,
      buyerName: einvoices.buyerName,
      buyerTaxCode: einvoices.buyerTaxCode,
      vatRate: einvoices.vatRate,
      totalBeforeVat: einvoices.totalBeforeVat,
      vatAmount: einvoices.vatAmount,
      issuedAt: einvoices.issuedAt,
      orderId: einvoices.orderId,
      orderCode: orders.code,
      orderTotal: orders.total,
    })
    .from(einvoices)
    .innerJoin(orders, eq(einvoices.orderId, orders.id))
    .orderBy(desc(einvoices.createdAt))
    .limit(50);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-[17px] font-bold">{t("einvoice.title")}</h1>
      </div>
      <p className="text-xs text-warn mb-5">⚠ {t("einvoice.stubNote")}</p>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileCheck2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("einvoice.empty")}</p>
          <p className="text-sm mt-1">{t("einvoice.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-surface border border-border rounded-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="font-medium">{r.number}<span className="text-xs text-slate-400 ml-1">{r.serial}</span></div><div className="text-xs text-slate-400">{r.issuedAt ? formatDate(r.issuedAt) : "—"} · {r.buyerName}</div></div>
                <Link href={Routes.order(r.orderId)} className="shrink-0 text-xs text-primary-600 hover:underline">{r.orderCode}</Link>
              </div>
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-slate-500">VAT {Number(r.vatRate)}%: {formatCurrency(Number(r.vatAmount))}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(Number(r.orderTotal))}</span>
              </div>
            </div>
          ))}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("einvoice.cols.number")}</th>
                <th className="px-4 py-3 font-semibold">{t("einvoice.cols.issuedAt")}</th>
                <th className="px-4 py-3 font-semibold">{t("einvoice.cols.order")}</th>
                <th className="px-4 py-3 font-semibold">{t("einvoice.cols.buyer")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("einvoice.cols.beforeVat")}</th>
                <th className="px-4 py-3 font-semibold text-right">VAT</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{r.number}<div className="text-xs text-slate-400">{r.serial}</div></td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.issuedAt ? formatDate(r.issuedAt) : "—"}</td>
                  <td className="px-4 py-3"><Link href={Routes.order(r.orderId)} className="text-primary-600 hover:underline">{r.orderCode}</Link></td>
                  <td className="px-4 py-3">{r.buyerName}{r.buyerTaxCode && <div className="text-xs text-slate-400">MST: {r.buyerTaxCode}</div>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(r.totalBeforeVat))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(Number(r.vatAmount))} ({Number(r.vatRate)}%)</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(r.orderTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
