"use client";

import { useTranslations } from "next-intl";
import { PackageOpen } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { MobileRecordField } from "@/components/mobile-ui";
import { OrderDetailLink } from "@/components/order-detail-link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
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
      render: (invoice) => <OrderSummaryLink row={invoice} />,
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
      render: (invoice) => <PartnerDetailLink kind="customer" partnerId={invoice.customerId} name={invoice.customerName} className="font-medium" />,
    },
    {
      key: "status",
      label: t("orders.cols.status"),
      defaultVisible: true,
      width: "140px",
      render: (invoice) => <OrderStatus status={invoice.status} />,
    },
    {
      key: "revenue",
      label: "Doanh thu thuần",
      defaultVisible: true,
      align: "right",
      width: "160px",
      cellClassName: "font-medium",
      render: (invoice) => formatCurrency(Number(invoice.total)),
    },
    {
      key: "cost",
      label: "Giá vốn",
      defaultVisible: true,
      align: "right",
      width: "160px",
      render: (invoice) => formatCurrency(invoice.cost),
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
    {
      key: "margin",
      label: "Biên lãi",
      defaultVisible: true,
      align: "right",
      width: "120px",
      render: (invoice) => `${invoice.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`,
    },
    {
      key: "refund",
      label: "Hoàn trả",
      defaultVisible: true,
      align: "right",
      width: "140px",
      render: (invoice) => invoice.refund > 0 ? formatCurrency(invoice.refund) : "—",
    },
  ];

  return (
    <DataTableShell
      tableId="reports.invoices"
      rows={rows}
      columns={columns}
      getRowId={(invoice) => invoice.id}
      minWidth="900px"
      minHeight={420}
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
      <OrderSummaryLink row={row} mobile />
      <div className="text-xs font-medium text-slate-400">
        {formatDate(row.createdAt)} · <PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <MobileRecordField
          label={t("orders.cols.total")}
          value={formatCurrency(Number(row.total))}
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField label={t("orders.cols.status")} value={<OrderStatus status={row.status} />} />
        <MobileRecordField label="Giá vốn" value={formatCurrency(row.cost)} />
        <MobileRecordField
          label={t("reports.profit")}
          value={formatCurrency(profit)}
          tone={profit >= 0 ? "success" : "danger"}
          className="[&_dd]:break-words [&_dd]:whitespace-normal"
        />
        <MobileRecordField label="Biên lãi" value={`${row.margin.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`} />
      </dl>
    </div>
  );
}

function OrderSummaryLink({ row, mobile = false }: { row: ReportInvoiceRow; mobile?: boolean }) {
  const count = row.productCount.toLocaleString("vi-VN");
  return (
    <OrderDetailLink
      orderId={row.id}
      ariaLabel={`Mở chi tiết đơn ${row.code}, gồm ${count} sản phẩm`}
      className={cn(
        "inline-flex max-w-full min-w-11 flex-col items-start justify-center rounded-md px-2 -ml-2 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        mobile ? "min-h-11" : "min-h-10",
      )}
    >
      <span className={cn("max-w-full truncate font-semibold text-primary-600 hover:underline", mobile && "font-black")}>{row.code}</span>
      <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
        <PackageOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {count} sản phẩm
      </span>
    </OrderDetailLink>
  );
}

function OrderStatus({ status }: { status: ReportInvoiceRow["status"] }) {
  const label = status === "completed" ? "Hoàn thành" : status === "returned" ? "Hoàn trả" : status === "cancelled" ? "Đã hủy" : "Đang xử lý";
  return <span className={cn("inline-flex rounded-md px-2 py-1 text-[10px] font-bold", status === "completed" ? "bg-emerald-50 text-emerald-700" : status === "returned" ? "bg-teal-50 text-teal-700" : status === "cancelled" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700")}>{label}</span>;
}
