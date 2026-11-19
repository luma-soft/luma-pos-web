"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { mobileLedgerDateTime } from "@/components/partners/partner-mobile-ledger";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { PurchaseDetailModal, PurchaseStatusBadge, purchaseOwed, type PurchaseRow } from "./purchase-detail-modal";

export function PurchasesTable({ rows: serverRows, loadMore, printTemplates, detailPurchase = null }: { rows: PurchaseRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<PurchaseRow>; detailPurchase?: PurchaseRow | null; printTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[] }) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
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
        mobileListClassName="max-lg:-mx-4 max-lg:space-y-0 max-lg:bg-surface"
        mobileRowClassName="max-lg:rounded-none max-lg:border-0 max-lg:bg-[linear-gradient(var(--color-border),var(--color-border))] max-lg:bg-[length:calc(100%-16px)_1px] max-lg:bg-right-bottom max-lg:bg-no-repeat"
        renderMobileRow={({ row: purchase }) => <PurchaseMobileRow purchase={purchase} onOpen={() => setSelectedPurchaseId(purchase.id)} />}
      />
      {loadMoreFooter}

      <PurchaseDetailModal
        purchase={selectedPurchase}
        printTemplates={printTemplates}
        onClose={() => setSelectedPurchaseId(null)}
      />
    </>
  );
}

/** NativePurchaseReceiptRowView: supplier and status, date · code, items and total, owed. */
function PurchaseMobileRow({ purchase, onOpen }: { purchase: PurchaseRow; onOpen: () => void }) {
  const t = useTranslations("mobile.purchases");
  const owed = purchaseOwed(purchase);
  const statusTone = purchase.status === "cancelled" ? "text-ios-red" : purchase.status === "received" ? "text-ios-green" : "text-ios-orange";
  return (
    <button type="button" onClick={onOpen} aria-label={`${purchase.supplierName ?? ""} · ${purchase.code}`} className="block w-full space-y-[7px] px-4 py-ios-row text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-[22px]">{purchase.supplierName}</span>
        <span className={cn("shrink-0 text-[12px] font-semibold", statusTone)}>{t(`status.${purchase.status}` as never)}</span>
      </span>
      <span className="block truncate text-[11px] text-ios-label-tertiary">{mobileLedgerDateTime(purchase.createdAt)} · {purchase.code}</span>
      <span className="flex items-baseline gap-2 text-[12px] text-ios-label-secondary">
        <span className="min-w-0 flex-1">{t("itemCount", { count: purchase.items.length })}</span>
        <span className="font-semibold tabular-nums">{formatCurrency(Number(purchase.total))}</span>
      </span>
      {owed > 0 && <span className="block text-right text-[12px] font-medium tabular-nums text-ios-orange">{t("owed", { amount: formatCurrency(owed) })}</span>}
    </button>
  );
}
