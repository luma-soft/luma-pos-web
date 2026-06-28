import { getTranslations } from "next-intl/server";
import { desc, eq } from "drizzle-orm";
import { FileCheck2 } from "lucide-react";
import { db } from "@/db";
import { einvoices, orders } from "@/db/schema";
import { EInvoicesTable } from "./einvoices-table";

export async function EInvoicesTab() {
  const t = await getTranslations();
  const rows = await db
    .select({
      id: einvoices.id, number: einvoices.number, serial: einvoices.serial, status: einvoices.status,
      buyerName: einvoices.buyerName, buyerTaxCode: einvoices.buyerTaxCode, vatRate: einvoices.vatRate,
      totalBeforeVat: einvoices.totalBeforeVat, vatAmount: einvoices.vatAmount, issuedAt: einvoices.issuedAt,
      orderId: einvoices.orderId, orderCode: orders.code, orderTotal: orders.total,
    })
    .from(einvoices).innerJoin(orders, eq(einvoices.orderId, orders.id)).orderBy(desc(einvoices.createdAt)).limit(50);

  return (
    <>
      <p className="text-xs text-warn mb-5">⚠ {t("einvoice.stubNote")}</p>

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
