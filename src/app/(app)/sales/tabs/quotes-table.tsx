"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { QuoteActions } from "../../quotes/quote-actions";

type QuoteRow = {
  id: string;
  code: string;
  total: string | number;
  projectName: string | null;
  createdAt: Date | string;
  customerName: string | null;
};

export function QuotesTable({
  rows,
  expandedId,
  expandedContent,
}: {
  rows: QuoteRow[];
  expandedId?: string | null;
  expandedContent?: ReactNode;
}) {
  const t = useTranslations();
  const columns: DataTableColumn<QuoteRow>[] = [
    { key: "code", label: t("quotes.cols.code"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => row.customerName ?? t("orders.walkIn") },
    { key: "project", label: t("orders.cols.project"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.projectName ?? "—"}</span> },
    { key: "value", label: t("quotes.cols.value"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.total)) },
    { key: "actions", label: "", required: true, width: "110px", align: "right", render: (row) => <span onClick={stopRowToggle}><QuoteActions quoteId={row.id} /></span> },
  ];
  return (
    <DataTableShell
      tableId="sales.quotes"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      expandedParam="expandedQuote"
      initialExpandedId={expandedId}
      minWidth="880px"
      renderExpanded={(row) => (expandedId === row.id ? expandedContent : null)}
    />
  );
}
