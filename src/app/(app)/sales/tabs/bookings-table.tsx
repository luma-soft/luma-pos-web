"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";

type BookingRow = {
  id: string;
  code: string;
  total: string | number;
  projectName: string | null;
  deliveryDate: Date | string | null;
  createdAt: Date | string;
  customerName: string | null;
};

export function BookingsTable({
  rows,
  expandedId,
  expandedContent,
}: {
  rows: BookingRow[];
  expandedId?: string | null;
  expandedContent?: ReactNode;
}) {
  const t = useTranslations();
  const columns: DataTableColumn<BookingRow>[] = [
    { key: "code", label: t("bookings.cols.code"), required: true, width: "170px", render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "delivery", label: t("bookings.cols.deliveryDate"), defaultVisible: true, width: "170px", render: (row) => row.deliveryDate ? <span className="text-slate-600">{formatDate(row.deliveryDate)}</span> : <span className="text-slate-400">—</span> },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => row.customerName ?? t("orders.walkIn") },
    { key: "project", label: t("orders.cols.project"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.projectName ?? "—"}</span> },
    { key: "value", label: t("bookings.cols.value"), defaultVisible: true, align: "right", width: "140px", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.total)) },
  ];
  return (
    <DataTableShell
      tableId="sales.bookings"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      expandedParam="expandedBooking"
      initialExpandedId={expandedId}
      minWidth="960px"
      renderExpanded={(row) => (expandedId === row.id ? expandedContent : null)}
    />
  );
}
