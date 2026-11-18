"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { MobileDocumentRow } from "./mobile-document-row";
import { mobileDocumentDayGroups, mobileDocumentTimestamp } from "./mobile-document-day";

type QuoteRow = {
  id: string;
  code: string;
  total: string | number;
  projectName: string | null;
  createdAt: Date | string;
  customerId: string | null;
  customerName: string | null;
};

export function QuotesTable({
  rows: serverRows,
  loadMore,
}: {
  rows: QuoteRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<QuoteRow>;
}) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openOrder(row: QuoteRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("detailOrderId", row.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const locale = useLocale();
  const dayGroups = mobileDocumentDayGroups(rows, (row) => row.createdAt, (row) => Number(row.total), {
    locale,
    today: (date) => t("mobile.invoices.groupToday", { date }),
    yesterday: (date) => t("mobile.invoices.groupYesterday", { date }),
    summary: (count, total) => t("mobile.invoices.groupSummary", { count, total }),
  });
  const columns: DataTableColumn<QuoteRow>[] = [
    { key: "code", label: t("quotes.cols.code"), required: true, width: "170px", render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "170px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, wrap: true, render: (row) => <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? t("orders.walkIn")} openInCurrentTab className="whitespace-normal break-words" /> },
    { key: "project", label: t("orders.cols.project"), defaultVisible: true, wrap: true, render: (row) => <span className="whitespace-normal break-words text-slate-500">{row.projectName ?? "—"}</span> },
    { key: "value", label: t("quotes.cols.value"), defaultVisible: true, align: "right", width: "180px", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.total)) },
  ];
  return (
    <>
    <DataTableShell
      tableId="sales.quotes"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      mobileListClassName="-mx-4 space-y-0 border-t border-border bg-surface"
      mobileRowClassName="!rounded-none !border-0"
      minWidth="880px"
      onRowClick={openOrder}
      rowClickMode="row"
      renderMobileRow={({ row }) => (
        <MobileDocumentRow
          code={row.code}
          dayGroup={dayGroups.get(row.id)}
          customerName={row.customerName ?? t("orders.walkIn")}
          customer={(
            <PartnerDetailLink
              kind="customer"
              partnerId={row.customerId}
              name={row.customerName ?? t("orders.walkIn")}
              openInCurrentTab
              className="pointer-events-auto relative z-10 -my-3 block truncate py-3 text-foreground"
            />
          )}
          amount={formatCurrency(Number(row.total))}
          createdAt={mobileDocumentTimestamp(row.createdAt, locale)}
          details={row.projectName ? (
            <span className="block truncate">{t("orders.cols.project")}: {row.projectName}</span>
          ) : undefined}
          onOpen={() => openOrder(row)}
        />
      )}
      empty={(
        <SalesTableEmptyState
          icon={FileSpreadsheet}
          title={t("quotes.empty")}
          description={t("quotes.emptyHint")}
        />
      )}
    />
    {loadMoreFooter}
    </>
  );
}
