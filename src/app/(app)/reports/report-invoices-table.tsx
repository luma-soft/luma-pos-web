"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileRecordField } from "@/components/mobile-ui";
import { OrderDetailLink } from "@/components/order-detail-link";
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
        <OrderDetailLink orderId={invoice.id} className="font-semibold text-primary-600 hover:underline">
          {invoice.code}
        </OrderDetailLink>
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
      empty={<div className="rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400">{t("dashboard.noData")}</div>}
      renderMobileRow={({ row }) => <ReportInvoiceMobileRow row={row} />}
    />
  );
}

export function ReportInvoiceMobileRow({ row }: { row: ReportInvoiceRow }) {
  const t = useTranslations();
  const profit = Number(row.profit);

  return (
    <div className="p-3">
      <OrderDetailLink
        orderId={row.id}
        className="inline-flex min-h-11 max-w-full items-center font-black text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-11"
      >
        <span className="truncate">{row.code}</span>
      </OrderDetailLink>
      <div className="text-xs font-medium text-slate-400">
        {formatDate(row.createdAt)} · {row.customerName}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <MobileRecordField
          label={t("orders.cols.total")}
          value={formatCurrency(Number(row.total))}
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField
          label={t("reports.collected")}
          value={formatCurrency(Number(row.amountPaid))}
          tone="success"
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField
          label={t("reports.profit")}
          value={formatCurrency(profit)}
          tone={profit >= 0 ? "success" : "danger"}
          className="col-span-2 [&_dd]:break-words [&_dd]:whitespace-normal"
        />
      </dl>
    </div>
  );
}
