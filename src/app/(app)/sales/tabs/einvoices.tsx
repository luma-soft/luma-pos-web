import { getTranslations } from "next-intl/server";
import { FileCheck2 } from "lucide-react";
import { getEInvoiceQueue } from "@/lib/data/web-pages";
import { EInvoicesTable } from "./einvoices-table";
import { requireStoreContext } from "@/lib/auth/store-context";

export async function EInvoicesTab() {
  const [t, context] = await Promise.all([getTranslations(), requireStoreContext()]);
  const rows = await getEInvoiceQueue(context.storeId);

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
