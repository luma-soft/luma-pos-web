"use client";

import { PartnerDetailLink } from "@/components/partner-detail-link";

import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileRecordField } from "@/components/mobile-ui";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { ReportCustomerRow, ReportInventoryRow, ReportProductRow } from "@/lib/data/reports";
import { useReportFormat } from "./report-format";

const emptyClassName = "rounded-card border border-dashed border-border p-12 text-center text-sm text-slate-400";

export function ReportProductsTable({ rows }: { rows: ReportProductRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ReportProductRow>[] = [
    {
      key: "product",
      label: t("orders.cols.product"),
      required: true,
      width: "320px",
      wrap: true,
      render: (row) => <span className="whitespace-normal break-words font-medium">{row.productName}</span>,
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
      label: t("reports.d.cols.margin"),
      defaultVisible: true,
      align: "right",
      width: "120px",
      cellClassName: (row) => row.margin < 0 ? "font-semibold text-er" : "",
      render: (row) => `${row.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
    {
      key: "returns",
      label: t("reports.d.cols.refunds"),
      defaultVisible: true,
      align: "right",
      width: "110px",
      render: (row) => formatNumber(row.returnCount),
    },
    {
      key: "contribution",
      label: t("reports.d.cols.contribution"),
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
      width: "300px",
      wrap: true,
      render: (row) => (
        <div className="whitespace-normal break-words font-medium">
          <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName} openInCurrentTab className="block w-full whitespace-normal break-words" />
          {row.customerType && row.customerType !== "retail" ? ` (${t(`customers.types.${row.customerType}` as never)})` : ""}
        </div>
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
      label: t("reports.d.cols.customerType"),
      defaultVisible: true,
      width: "120px",
      render: (row) => <span className={row.segment === "new" ? "text-info" : "text-ok"}>{row.segment === "new" ? t("reports.d.kpi.newCustomers") : t("reports.d.kpi.returning")}</span>,
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
      label: t("reports.d.cols.margin"),
      defaultVisible: true,
      align: "right",
      width: "110px",
      render: (row) => `${row.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
    {
      key: "average",
      label: t("reports.d.cols.avgOrder"),
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
        <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName} openInCurrentTab className="max-w-full whitespace-normal break-words" />
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

export function ReportInventoryTable({ rows }: { rows: ReportInventoryRow[] }) {
  const f = useReportFormat();
  const { t } = f;
  const lastSold = (row: ReportInventoryRow) => row.lastSoldDay ? f.date(row.lastSoldDay, true) : t("inventory.never");
  const daysOfStock = (row: ReportInventoryRow) => row.daysOfStock == null ? "—" : t("inventory.days", { n: f.number(row.daysOfStock, 0) });
  const columns: DataTableColumn<ReportInventoryRow>[] = [
    {
      key: "product",
      label: t("inventory.product"),
      required: true,
      width: "320px",
      wrap: true,
      render: (row) => (
        <span className="whitespace-normal break-words">
          <span className="font-medium">{row.productName}</span>
          {row.sku && <span className="block text-xs text-slate-400">{row.sku}</span>}
        </span>
      ),
    },
    {
      key: "onHand",
      label: t("inventory.onHand"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: (row) => cn(row.minLevel > 0 && row.quantity <= row.minLevel && "font-semibold text-amber-600"),
      render: (row) => `${formatNumber(row.quantity)} ${row.baseUnit}`,
    },
    {
      key: "value",
      label: t("inventory.value"),
      defaultVisible: true,
      align: "right",
      width: "170px",
      cellClassName: "font-medium",
      render: (row) => formatCurrency(row.stockValue),
    },
    {
      key: "sold",
      label: t("inventory.sold"),
      defaultVisible: true,
      align: "right",
      width: "150px",
      cellClassName: (row) => row.soldQuantity === 0 ? "font-semibold text-er" : "text-slate-500",
      render: (row) => `${formatNumber(row.soldQuantity)} ${row.baseUnit}`,
    },
    {
      key: "daysOfStock",
      label: t("inventory.daysOfStock"),
      defaultVisible: true,
      align: "right",
      width: "120px",
      cellClassName: "text-slate-500",
      render: daysOfStock,
    },
    {
      key: "lastSold",
      label: t("inventory.lastSold"),
      defaultVisible: true,
      align: "right",
      width: "140px",
      cellClassName: (row) => row.lastSoldAt ? "text-slate-500" : "text-slate-400",
      render: lastSold,
    },
  ];
  return (
    <ReportTable
      tableId="report-inventory"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.productId}
      renderMobileRow={(row) => (
        <div className="p-3">
          <div className="break-words text-sm font-black leading-snug">{row.productName}</div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <MobileRecordField label={t("inventory.onHand")} value={`${formatNumber(row.quantity)} ${row.baseUnit}`} />
            <MobileRecordField label={t("inventory.value")} value={formatCurrency(row.stockValue)} />
            <MobileRecordField label={t("inventory.sold")} value={`${formatNumber(row.soldQuantity)} ${row.baseUnit}`} tone={row.soldQuantity === 0 ? "danger" : undefined} />
            <MobileRecordField label={t("inventory.lastSold")} value={lastSold(row)} />
          </dl>
        </div>
      )}
    />
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
