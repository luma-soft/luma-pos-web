"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Routes } from "@/lib/routes";

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
}: {
  rows: QuoteRow[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const columns: DataTableColumn<QuoteRow>[] = [
    { key: "code", label: t("quotes.cols.code"), required: true, width: "170px", render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "170px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => row.customerName ?? t("orders.walkIn") },
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
      onRowClick={(row) => router.push(Routes.order(row.id), { scroll: false })}
    />
  );
}
