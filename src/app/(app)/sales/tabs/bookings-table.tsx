"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { MobileDocumentRow } from "./mobile-document-row";
import { mobileDocumentDayGroups, mobileDocumentTimestamp } from "./mobile-document-day";

type BookingRow = {
  id: string;
  code: string;
  total: string | number;
  projectName: string | null;
  deliveryDate: Date | string | null;
  createdAt: Date | string;
  customerId: string | null;
  customerName: string | null;
};

export function BookingsTable({
  rows: serverRows,
  loadMore,
}: {
  rows: BookingRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<BookingRow>;
}) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openOrder(row: BookingRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("detailOrderId", row.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const locale = useLocale();
  const dayGroups = mobileDocumentDayGroups(rows, (row) => row.deliveryDate ?? row.createdAt, (row) => Number(row.total), {
    locale,
    today: (date) => t("mobile.invoices.groupToday", { date }),
    yesterday: (date) => t("mobile.invoices.groupYesterday", { date }),
    tomorrow: (date) => t("mobile.invoices.groupTomorrow", { date }),
    summary: (count, total) => t("mobile.invoices.groupSummary", { count, total }),
  });
  const columns: DataTableColumn<BookingRow>[] = [
    { key: "code", label: t("bookings.cols.code"), required: true, width: "170px", render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "delivery", label: t("bookings.cols.deliveryDate"), defaultVisible: true, width: "170px", render: (row) => row.deliveryDate ? <span className="text-slate-600">{formatDate(row.deliveryDate)}</span> : <span className="text-slate-400">—</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, wrap: true, render: (row) => <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? t("orders.walkIn")} openInCurrentTab className="whitespace-normal break-words" /> },
    { key: "project", label: t("orders.cols.project"), defaultVisible: true, wrap: true, render: (row) => <span className="whitespace-normal break-words text-slate-500">{row.projectName ?? "—"}</span> },
    { key: "value", label: t("bookings.cols.value"), defaultVisible: true, align: "right", width: "140px", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.total)) },
  ];
  return (
    <>
    <DataTableShell
      tableId="sales.bookings"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      mobileListClassName="-mx-4 space-y-0 border-t border-border bg-surface"
      mobileRowClassName="!rounded-none !border-0"
      minWidth="960px"
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
          details={(
            <>
              <span className="block truncate">
                {t("bookings.cols.deliveryDate")}: {row.deliveryDate ? formatDate(row.deliveryDate) : "—"}
              </span>
              {row.projectName && (
                <span className="mt-0.5 block truncate">{t("orders.cols.project")}: {row.projectName}</span>
              )}
            </>
          )}
          onOpen={() => openOrder(row)}
        />
      )}
      empty={(
        <SalesTableEmptyState
          icon={ClipboardList}
          title={t("bookings.empty")}
          description={t("bookings.emptyHint")}
        />
      )}
    />
    {loadMoreFooter}
    </>
  );
}
