"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { ReportCustomerRow, ReportEmployeeRow, ReportProductRow } from "@/lib/data/reports";

const emptyClassName = "rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400";

export function ReportProductsTable({ rows }: { rows: ReportProductRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReportProductRow>[] = [
    {
      key: "product",
      label: t("orders.cols.product"),
      required: true,
      render: (row) => <span className="font-medium">{row.productName}</span>,
    },
    {
      key: "quantity",
      label: t("reports.qtySold"),
      defaultVisible: true,
      align: "right",
      width: "170px",
      cellClassName: "text-slate-500",
      render: (row) => `${formatNumber(Number(row.qtySold))} ${row.baseUnit}`,
    },
    {
      key: "revenue",
      label: t("reports.revenue"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: "font-medium",
      render: (row) => formatCurrency(Number(row.revenue)),
    },
    {
      key: "profit",
      label: t("reports.grossProfit"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: (row) => cn("font-semibold", Number(row.profit) >= 0 ? "text-ok" : "text-er"),
      render: (row) => formatCurrency(Number(row.profit)),
    },
  ];
  return <ReportTable tableId="reports.products" rows={rows} columns={columns} getRowId={(row) => row.productId} />;
}

export function ReportCustomersTable({ rows }: { rows: ReportCustomerRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReportCustomerRow>[] = [
    {
      key: "customer",
      label: t("orders.cols.customer"),
      required: true,
      render: (row) => (
        <span className="font-medium">
          {row.customerName}
          {row.customerType && row.customerType !== "retail" ? ` (${t(`customers.types.${row.customerType}` as never)})` : ""}
        </span>
      ),
    },
    {
      key: "orders",
      label: t("reports.orders"),
      defaultVisible: true,
      align: "right",
      width: "140px",
      render: (row) => formatNumber(row.orderCount),
    },
    {
      key: "revenue",
      label: t("reports.revenue"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: "font-medium",
      render: (row) => formatCurrency(Number(row.revenue)),
    },
    {
      key: "uncollected",
      label: t("reports.uncollected"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: (row) => Number(row.remaining) > 0 ? "font-semibold text-er" : "text-slate-400",
      render: (row) => Number(row.remaining) > 0 ? formatCurrency(Number(row.remaining)) : "—",
    },
  ];
  return <ReportTable tableId="reports.customers" rows={rows} columns={columns} getRowId={(row) => row.customerId ?? "walkin"} />;
}

export function ReportEmployeesTable({ rows }: { rows: ReportEmployeeRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReportEmployeeRow>[] = [
    {
      key: "employee",
      label: t("reports.employee"),
      required: true,
      render: (row) => <span className="font-medium">{row.sellerName}</span>,
    },
    {
      key: "orders",
      label: t("reports.orders"),
      defaultVisible: true,
      align: "right",
      width: "140px",
      render: (row) => formatNumber(row.orderCount),
    },
    {
      key: "revenue",
      label: t("reports.revenue"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: "font-medium",
      render: (row) => formatCurrency(Number(row.revenue)),
    },
    {
      key: "collected",
      label: t("reports.collected"),
      defaultVisible: true,
      align: "right",
      width: "180px",
      cellClassName: "text-ok",
      render: (row) => formatCurrency(Number(row.collected)),
    },
  ];
  return <ReportTable tableId="reports.employees" rows={rows} columns={columns} getRowId={(row) => row.sellerId ?? "system"} />;
}

function ReportTable<T>({
  tableId,
  rows,
  columns,
  getRowId,
}: {
  tableId: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
}) {
  const t = useTranslations();
  return (
    <DataTableShell
      tableId={tableId}
      rows={rows}
      columns={columns}
      getRowId={getRowId}
      minWidth="760px"
      empty={<div className={emptyClassName}>{t("dashboard.noData")}</div>}
    />
  );
}
