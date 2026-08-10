import { getTranslations } from "next-intl/server";
import { and, desc, eq } from "drizzle-orm";
import { FileCheck2 } from "lucide-react";
import { db } from "@/db";
import { einvoices, orders } from "@/db/schema";
import { EInvoicesTable } from "./einvoices-table";
import { requireStoreContext } from "@/lib/auth/store-context";

export async function EInvoicesTab() {
  const [t, context] = await Promise.all([getTranslations(), requireStoreContext()]);
  const rows = await db
    .select({
      id: einvoices.id, number: einvoices.number, serial: einvoices.serial, status: einvoices.status,
      buyerName: einvoices.buyerName, buyerTaxCode: einvoices.buyerTaxCode, vatRate: einvoices.vatRate,
      totalBeforeVat: einvoices.totalBeforeVat, vatAmount: einvoices.vatAmount, issuedAt: einvoices.issuedAt,
      attemptCount: einvoices.attemptCount, nextAttemptAt: einvoices.nextAttemptAt, lastError: einvoices.lastError,
      orderId: einvoices.orderId, orderCode: orders.code, orderTotal: orders.total,
    })
    .from(einvoices).innerJoin(orders, and(eq(einvoices.orderId, orders.id), eq(orders.storeId, context.storeId))).where(eq(einvoices.storeId, context.storeId)).orderBy(desc(einvoices.createdAt)).limit(50);

  return (
    <>
      <p className="text-xs text-slate-500 mb-5">{t("einvoice.queueNote")}</p>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileCheck2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("einvoice.empty")}</p>
          <p className="text-sm mt-1">{t("einvoice.emptyHint")}</p>
        </div>
      ) : (
        <EInvoicesTable rows={rows} />
      )}
    </>
  );
}
