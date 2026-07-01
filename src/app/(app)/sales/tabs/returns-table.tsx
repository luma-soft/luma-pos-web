"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import type { ReturnListRow } from "@/lib/data/returns";
import { formatCurrency, formatDate } from "@/lib/utils";

export function ReturnsTable({ rows }: { rows: ReturnListRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReturnListRow>[] = [
    {
      key: "code",
      label: t("returns.cols.code"),
      required: true,
      width: "150px",
      render: (row) => <span className="font-semibold text-primary-600">{row.code}</span>,
    },
    {
      key: "date",
      label: t("orders.cols.date"),
      defaultVisible: true,
      width: "160px",
      render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "order",
      label: t("returns.sourceOrder"),
      defaultVisible: true,
      width: "160px",
      render: (row) => row.orderId && row.orderCode
        ? <Link href={Routes.salesOrder(row.orderId, "completed")} onClick={stopRowToggle} className="text-primary-600 hover:underline">{row.orderCode}</Link>
        : <span className="text-slate-400">-</span>,
    },
    {
      key: "customer",
      label: t("orders.cols.customer"),
      defaultVisible: true,
      render: (row) => row.customerName ?? t("orders.walkIn"),
    },
    {
      key: "reason",
      label: t("returns.reason"),
      defaultVisible: true,
      render: (row) => row.reason ? t(`returns.reasons.${row.reason}` as never) : <span className="text-slate-400">-</span>,
    },
    {
      key: "refundMethod",
      label: t("returns.refundVia"),
      defaultVisible: true,
      render: (row) => t(`returns.refundMethods.${row.refundMethod}`),
    },
    {
      key: "warehouse",
      label: t("returns.cols.warehouse"),
      defaultVisible: false,
      render: (row) => row.warehouseName ?? <span className="text-slate-400">-</span>,
    },
    {
      key: "createdBy",
      label: t("returns.cols.createdBy"),
      defaultVisible: false,
      render: (row) => row.createdByName ?? <span className="text-slate-400">-</span>,
    },
    {
      key: "totalRefund",
      label: t("returns.totalRefund"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: "font-semibold text-er",
      render: (row) => formatCurrency(Number(row.totalRefund)),
    },
    {
      key: "print",
      label: "",
      defaultVisible: true,
      align: "right",
      width: "92px",
      render: (row) => (
        <Link
          href={`/returns/${row.id}/print`}
          onClick={stopRowToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-surface-2 dark:text-slate-300"
        >
          <Printer className="h-3.5 w-3.5" />
          {t("returns.print")}
        </Link>
      ),
    },
  ];

  return (
    <DataTableShell
      tableId="sales.returns"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      expandedParam="expandedReturn"
      minWidth="1120px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("returns.sourceOrder")} value={row.orderCode ?? "-"} />
          <Info label={t("returns.refundVia")} value={t(`returns.refundMethods.${row.refundMethod}`)} />
          <Info label={t("returns.cols.warehouse")} value={row.warehouseName ?? "-"} />
          <Info label={t("returns.cols.createdBy")} value={row.createdByName ?? "-"} />
          {row.note && <div className="md:col-span-4"><Info label={t("orders.detail.notePlaceholder")} value={row.note} /></div>}
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
