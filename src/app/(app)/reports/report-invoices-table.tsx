"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { ReportInvoiceRow } from "@/lib/data/reports";

export function ReportInvoicesTable({ rows }: { rows: ReportInvoiceRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReportInvoiceRow>[] = [
    {
      key: "code",
      label: t("orders.cols.code"),
      required: true,
      width: "180px",
      render: (invoice) => (
        <Link href={Routes.salesOrder(invoice.id, invoice.status)} className="font-semibold text-primary-600 hover:underline">
          {invoice.code}
        </Link>
      ),
    },
    {
      key: "date",
      label: t("orders.cols.date"),
      defaultVisible: true,
      width: "170px",
      render: (invoice) => <span className="text-slate-500">{formatDate(invoice.createdAt)}</span>,
    },
    {
      key: "customer",
      label: t("orders.cols.customer"),
      defaultVisible: true,
      render: (invoice) => <span className="font-medium">{invoice.customerName}</span>,
    },
    {
      key: "total",
      label: t("orders.cols.total"),
      defaultVisible: true,
      align: "right",
      width: "160px",
      cellClassName: "font-medium",
      render: (invoice) => formatCurrency(Number(invoice.total)),
    },
    {
      key: "collected",
      label: t("reports.collected"),
      defaultVisible: true,
      align: "right",
      width: "160px",
      cellClassName: "text-ok",
      render: (invoice) => formatCurrency(Number(invoice.amountPaid)),
    },
    {
      key: "profit",
      label: t("reports.profit"),
      defaultVisible: true,
      align: "right",
      width: "160px",
      cellClassName: (invoice) => cn("font-semibold", Number(invoice.profit) >= 0 ? "text-ok" : "text-er"),
      render: (invoice) => formatCurrency(Number(invoice.profit)),
    },
  ];

  return (
    <DataTableShell
      tableId="reports.invoices"
      rows={rows}
      columns={columns}
      getRowId={(invoice) => invoice.id}
      minWidth="900px"
      maxHeight=""
      fillHeight={false}
      empty={<div className="rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400">{t("dashboard.noData")}</div>}
      renderMobileRow={({ row: invoice }) => (
        <div className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={Routes.salesOrder(invoice.id, invoice.status)} className="font-semibold text-primary-600 hover:underline">
                {invoice.code}
              </Link>
              <div className="mt-0.5 text-xs text-slate-400">{formatDate(invoice.createdAt)} · {invoice.customerName}</div>
            </div>
            <div className={cn("shrink-0 font-semibold tabular-nums", Number(invoice.profit) >= 0 ? "text-ok" : "text-er")}>
              {formatCurrency(Number(invoice.profit))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="font-medium tabular-nums">{formatCurrency(Number(invoice.total))}</span>
            <span className="tabular-nums text-ok">{t("reports.collected")}: {formatCurrency(Number(invoice.amountPaid))}</span>
          </div>
        </div>
      )}
    />
  );
}
