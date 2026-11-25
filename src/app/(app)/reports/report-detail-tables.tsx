"use client";

import { PartnerDetailLink } from "@/components/partner-detail-link";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, CircleUserRound, Package, type LucideIcon } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { ReportCustomerRow, ReportInventoryRow, ReportProductRow } from "@/lib/data/reports";
import { useReportFormat } from "./report-format";

/** Phone list: one grouped card of hairline rows, like the iOS report rankings. */
export const reportMobileListClassName = "!space-y-0 overflow-hidden rounded-[14px] bg-surface px-3 [&>*:not(:first-child)]:shadow-[inset_0_1px_0_var(--color-border)]";
export const reportMobileRowClassName = "!rounded-none !border-0 !bg-transparent";

/** NativeReportRankedRowView: accent icon, title, secondary subtitle, value on the right. */
export function ReportMobileRow({
  icon: Icon,
  title,
  subtitle,
  value,
  valueClassName,
  onOpen,
  openLabel,
}: {
  icon: LucideIcon;
  title: ReactNode;
  subtitle: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <div className="relative flex items-center gap-3 py-2">
      {onOpen && (
        <button type="button" onClick={onOpen} aria-label={openLabel} className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-primary-500" />
      )}
      <Icon className="pointer-events-none size-5 shrink-0 text-ios-accent" aria-hidden="true" />
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium leading-5">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-ios-label-secondary">{subtitle}</div>
      </div>
      <div className={cn("pointer-events-none shrink-0 text-[15px] font-semibold tabular-nums", valueClassName)}>{value}</div>
    </div>
  );
}

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
  const f = useReportFormat();
  const profit = Number(row.profit);
  const revenue = Number(row.revenue);
  const margin = revenue === 0 ? 0 : (profit / revenue) * 100;
  return (
    <ReportMobileRow
      icon={BarChart3}
      title={row.productName}
      subtitle={`${formatNumber(Number(row.qtySold))} ${row.baseUnit} · ${t("reports.grossProfit")} ${f.money(profit)} · ${f.percent(margin)}`}
      value={f.money(revenue)}
    />
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
  const f = useReportFormat();
  const remaining = Number(row.remaining);
  const type = row.customerType && row.customerType !== "retail" ? ` (${t(`customers.types.${row.customerType}` as never)})` : "";
  return (
    <ReportMobileRow
      icon={CircleUserRound}
      title={<><PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName} openInCurrentTab className="pointer-events-auto relative z-10 max-w-full" />{type}</>}
      subtitle={`${t("reports.orders")}: ${formatNumber(row.orderCount)}${remaining > 0 ? ` · ${t("reports.uncollected")} ${f.money(remaining)}` : ""}`}
      value={f.money(Number(row.revenue))}
    />
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
        <ReportMobileRow
          icon={Package}
          title={row.productName}
          subtitle={`${t("inventory.onHand")} ${formatNumber(row.quantity)} ${row.baseUnit} · ${t("inventory.sold")} ${formatNumber(row.soldQuantity)} · ${t("inventory.lastSold")} ${lastSold(row)}`}
          value={f.money(row.stockValue)}
        />
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
      mobileListClassName={reportMobileListClassName}
      mobileRowClassName={reportMobileRowClassName}
      minWidth="760px"
      minHeight={420}
      empty={<div className={emptyClassName}>{t("dashboard.noData")}</div>}
    />
  );
}
