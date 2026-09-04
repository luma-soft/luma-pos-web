"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SalesTableEmptyState } from "./sales-table-empty-state";
import { PartnerDetailLink } from "@/components/partner-detail-link";

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
  rows,
}: {
  rows: QuoteRow[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openOrder(row: QuoteRow) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("detailOrderId", row.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const columns: DataTableColumn<QuoteRow>[] = [
    { key: "code", label: t("quotes.cols.code"), required: true, width: "170px", render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "170px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? t("orders.walkIn")} /> },
    { key: "project", label: t("orders.cols.project"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.projectName ?? "—"}</span> },
    { key: "value", label: t("quotes.cols.value"), defaultVisible: true, align: "right", width: "140px", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.total)) },
  ];
  return (
    <DataTableShell
      tableId="sales.quotes"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="880px"
      onRowClick={openOrder}
      renderMobileRow={({ row }) => (
        <div className="p-3">
          <button type="button" onClick={() => openOrder(row)} className="min-h-11 w-full space-y-1 text-left">
            <span className="block font-semibold text-primary-600">{row.code}</span>
            <span className="block text-slate-500">{formatDate(row.createdAt)}</span>
          </button>
          <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? t("orders.walkIn")} className="inline-flex min-h-11 items-center" />
        </div>
      )}
      empty={(
        <SalesTableEmptyState
          icon={FileSpreadsheet}
          title={t("quotes.empty")}
          description={t("quotes.emptyHint")}
        />
      )}
    />
  );
}
