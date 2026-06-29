"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate } from "@/lib/utils";

type EInvoiceRow = {
  id: string;
  number: string | null;
  serial: string;
  status: string;
  buyerName: string;
  buyerTaxCode: string | null;
  vatRate: string | number;
  totalBeforeVat: string | number;
  vatAmount: string | number;
  issuedAt: Date | string | null;
  orderId: string;
  orderCode: string;
  orderTotal: string | number;
};

export function EInvoicesTable({ rows }: { rows: EInvoiceRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<EInvoiceRow>[] = [
    { key: "number", label: t("einvoice.cols.number"), required: true, render: (row) => <span className="font-medium">{row.number ?? "-"}<span className="ml-1 text-xs text-slate-400">{row.serial}</span></span> },
    { key: "issuedAt", label: t("einvoice.cols.issuedAt"), defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{row.issuedAt ? formatDate(row.issuedAt) : "-"}</span> },
    { key: "order", label: t("einvoice.cols.order"), defaultVisible: true, render: (row) => <Link href={`${Routes.Sales}?tab=orders&orderId=${encodeURIComponent(row.orderId)}&expandedOrder=${encodeURIComponent(row.orderId)}`} className="text-primary-600 hover:underline">{row.orderCode}</Link> },
    { key: "buyer", label: t("einvoice.cols.buyer"), defaultVisible: true, render: (row) => <span>{row.buyerName}{row.buyerTaxCode && <span className="ml-1 text-xs text-slate-400">MST: {row.buyerTaxCode}</span>}</span> },
    { key: "beforeVat", label: t("einvoice.cols.beforeVat"), defaultVisible: true, align: "right", render: (row) => formatCurrency(Number(row.totalBeforeVat)) },
    { key: "vat", label: "VAT", defaultVisible: true, align: "right", render: (row) => `${formatCurrency(Number(row.vatAmount))} (${Number(row.vatRate)}%)` },
    { key: "total", label: t("orders.cols.total"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.orderTotal)) },
  ];
  return (
    <DataTableShell
      tableId="sales.einvoices"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1040px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("einvoice.cols.number")} value={`${row.serial} · ${row.number ?? "-"}`} />
          <Info label={t("einvoice.cols.buyer")} value={row.buyerName} />
          <Info label="VAT" value={`${formatCurrency(Number(row.vatAmount))} (${Number(row.vatRate)}%)`} />
          <Info label={t("orders.cols.total")} value={formatCurrency(Number(row.orderTotal))} />
        </div>
      )}
    />
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
