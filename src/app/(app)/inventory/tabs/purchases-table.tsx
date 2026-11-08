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
      render: (purchase) => <PartnerDetailLink kind="supplier" partnerId={purchase.supplierId} name={purchase.supplierName} openInCurrentTab className="whitespace-normal break-words" />,
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
        rowClickMode="row"
        renderMobileRow={({ row: purchase }) => {
          const owed = purchaseOwed(purchase);
          return (
            <div className="relative min-h-[112px] p-3">
              <button type="button" onClick={() => setSelectedPurchaseId(purchase.id)}
                aria-label={purchase.code}
                className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-primary-500" />
              <div className="pointer-events-none relative flex items-start justify-between gap-3">
                <PartnerDetailLink
                  kind="supplier"
                  partnerId={purchase.supplierId}
                  name={purchase.supplierName}
                  openInCurrentTab
                  className="pointer-events-auto relative z-10 min-w-0 flex-1 truncate text-[15px] font-semibold"
                />
                <PurchaseStatusBadge status={purchase.status} />
              </div>
              <div className="pointer-events-none relative mt-1.5 truncate text-[11px] text-slate-500">
                {formatDate(purchase.createdAt)} · {purchase.code}
              </div>
              <div className="pointer-events-none relative mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">{t("purchases.cols.itemCount")}: {purchase.items.length}</span>
                <span className="max-w-[55%] text-right text-sm font-semibold tabular-nums text-foreground [overflow-wrap:anywhere]">
                  {formatCurrency(Number(purchase.total))}
                </span>
              </div>
              {owed > 0 && (
                <div className="pointer-events-none relative mt-1.5 text-right text-xs font-semibold tabular-nums text-warn">
                  {t("purchases.cols.owed")}: {formatCurrency(owed)}
                </div>
              )}
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
