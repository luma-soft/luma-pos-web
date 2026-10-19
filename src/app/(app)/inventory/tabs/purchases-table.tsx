"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { PurchaseDetailModal, PurchaseStatusBadge, purchaseOwed, type PurchaseRow } from "./purchase-detail-modal";

export function PurchasesTable({ rows, printTemplates, detailPurchase = null }: { rows: PurchaseRow[]; detailPurchase?: PurchaseRow | null; printTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[] }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const selectedPurchaseId = searchParams.get("detailPurchaseId");
  const selectedPurchase = rows.find((row) => row.id === selectedPurchaseId)
    ?? (detailPurchase?.id === selectedPurchaseId ? detailPurchase : null);
  function setSelectedPurchaseId(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("detailPurchaseId", id);
    else params.delete("detailPurchaseId");
    window.history.replaceState(null, "", `?${params.toString()}`);
  }
  const columns: DataTableColumn<PurchaseRow>[] = [
    { key: "code", label: t("purchases.cols.code"), required: true, render: (purchase) => <span className="font-semibold text-primary-600">{purchase.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (purchase) => <span className="text-slate-500">{formatDate(purchase.createdAt)}</span> },
    {
      key: "supplier",
      label: t("purchases.cols.supplier"),
      defaultVisible: true,
      width: "30%",
      wrap: true,
      cellClassName: "overflow-visible whitespace-normal text-clip break-words",
      render: (purchase) => <PartnerDetailLink kind="supplier" partnerId={purchase.supplierId} name={purchase.supplierName} openInCurrentTab className="block w-full whitespace-normal break-words" />,
    },
    { key: "total", label: t("orders.cols.total"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (purchase) => formatCurrency(Number(purchase.total)) },
    { key: "owed", label: t("purchases.cols.owed"), defaultVisible: true, align: "right", cellClassName: (purchase) => purchaseOwed(purchase) > 0 ? "font-semibold text-warn" : "text-slate-400", render: (purchase) => purchaseOwed(purchase) > 0 ? formatCurrency(purchaseOwed(purchase)) : "—" },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (purchase) => <PurchaseStatusBadge status={purchase.status} /> },
  ];
  return (
    <>
      <DataTableShell
        tableId="inventory.purchases"
        rows={rows}
        columns={columns}
        getRowId={(purchase) => purchase.id}
        minWidth="1080px"
        onRowClick={(purchase) => setSelectedPurchaseId(purchase.id)}
        rowClickColumnKey="code"
        renderMobileRow={({ row: purchase }) => {
          const owed = purchaseOwed(purchase);
          return (
            <div className="w-full p-3 text-left">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button type="button" onClick={() => setSelectedPurchaseId(purchase.id)} className="min-h-11 rounded-sm text-left font-semibold text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{purchase.code}</button>
                  <div className="text-xs text-slate-400">{formatDate(purchase.createdAt)} · <PartnerDetailLink kind="supplier" partnerId={purchase.supplierId} name={purchase.supplierName} openInCurrentTab className="max-w-full whitespace-normal break-words" /></div>
                </div>
                <PurchaseStatusBadge status={purchase.status} />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-semibold tabular-nums">{formatCurrency(Number(purchase.total))}</span>
                {owed > 0 && <span className="font-semibold tabular-nums text-warn">{formatCurrency(owed)}</span>}
              </div>
            </div>
          );
        }}
      />

      <PurchaseDetailModal
        purchase={selectedPurchase}
        printTemplates={printTemplates}
        onClose={() => setSelectedPurchaseId(null)}
      />
    </>
  );
}
