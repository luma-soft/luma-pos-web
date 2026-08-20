"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileRecordField } from "@/components/mobile-ui";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { ReportCustomerRow, ReportProductRow } from "@/lib/data/reports";

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
    {
      key: "margin",
      label: "Biên lãi",
      defaultVisible: true,
      align: "right",
      width: "120px",
      cellClassName: (row) => row.margin < 0 ? "font-semibold text-er" : "",
      render: (row) => `${row.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
    {
      key: "returns",
      label: "Hoàn trả",
      defaultVisible: true,
      align: "right",
      width: "110px",
      render: (row) => formatNumber(row.returnCount),
    },
    {
      key: "contribution",
      label: "Đóng góp",
      defaultVisible: true,
      align: "right",
      width: "130px",
      render: (row) => `${row.contribution.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
  ];
  return (
    <ReportTable
      tableId="reports.products"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.productId}
      renderMobileRow={(row) => <ReportProductMobileRow row={row} />}
    />
  );
}

export function ReportProductMobileRow({ row }: { row: ReportProductRow }) {
  const t = useTranslations();
  const profit = Number(row.profit);

  return (
    <div className="p-3">
      <div className="break-words text-sm font-black leading-snug">{row.productName}</div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <MobileRecordField label={t("reports.qtySold")} value={`${formatNumber(Number(row.qtySold))} ${row.baseUnit}`} />
        <MobileRecordField
          label={t("reports.revenue")}
          value={formatCurrency(Number(row.revenue))}
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField
          label={t("reports.grossProfit")}
          value={formatCurrency(profit)}
          tone={profit >= 0 ? "success" : "danger"}
          className="col-span-2 [&_dd]:break-words [&_dd]:whitespace-normal"
        />
      </dl>
    </div>
  );
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
      key: "segment",
      label: "Loại khách",
      defaultVisible: true,
      width: "120px",
      render: (row) => <span className={row.segment === "new" ? "text-info" : "text-ok"}>{row.segment === "new" ? "Khách mới" : "Quay lại"}</span>,
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
      cellClassName: (row) => row.profit >= 0 ? "font-semibold text-ok" : "font-semibold text-er",
      render: (row) => formatCurrency(row.profit),
    },
    {
      key: "margin",
      label: "Biên lãi",
      defaultVisible: true,
      align: "right",
      width: "110px",
      render: (row) => `${row.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
    {
      key: "average",
      label: "Giá trị TB",
      defaultVisible: true,
      align: "right",
      width: "150px",
      render: (row) => formatCurrency(row.averageOrder),
    },
  ];
  return (
    <ReportTable
      tableId="reports.customers"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.customerId ?? "walkin"}
      renderMobileRow={(row) => <ReportCustomerMobileRow row={row} />}
    />
  );
}

export function ReportCustomerMobileRow({ row }: { row: ReportCustomerRow }) {
  const t = useTranslations();
  const remaining = Number(row.remaining);

  return (
    <div className="p-3">
      <div className="break-words text-sm font-black leading-snug">
        {row.customerName}
        {row.customerType && row.customerType !== "retail" ? ` (${t(`customers.types.${row.customerType}` as never)})` : ""}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <MobileRecordField label={t("reports.orders")} value={formatNumber(row.orderCount)} />
        <MobileRecordField
          label={t("reports.revenue")}
          value={formatCurrency(Number(row.revenue))}
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField
          label={t("reports.uncollected")}
          value={remaining > 0 ? formatCurrency(remaining) : "—"}
          tone={remaining > 0 ? "danger" : "neutral"}
          className="col-span-2 [&_dd]:break-words [&_dd]:whitespace-normal"
        />
      </dl>
    </div>
  );
}

function ReportTable<T>({
  tableId,
  rows,
  columns,
  getRowId,
  renderMobileRow,
}: {
  tableId: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  renderMobileRow: (row: T) => React.ReactNode;
}) {
  const t = useTranslations();
  return (
    <DataTableShell
      tableId={tableId}
      rows={rows}
      columns={columns}
      getRowId={getRowId}
      renderMobileRow={({ row }) => renderMobileRow(row)}
      minWidth="760px"
      minHeight={420}
      empty={<div className={emptyClassName}>{t("dashboard.noData")}</div>}
    />
  );
}
