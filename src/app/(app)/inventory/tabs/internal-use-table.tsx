"use client";

import { useLocale, useTranslations } from "next-intl";
import { Copy, FileDown, LayoutList, Printer, Save } from "lucide-react";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { getInternalUseIssues } from "@/lib/data/internal-use";

type InternalUseRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];

export function InternalUseTable({ rows }: { rows: InternalUseRow[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const isVi = locale === "vi";

  const columns: DataTableColumn<InternalUseRow>[] = [
    {
      key: "code",
      label: isVi ? "Mã phiếu" : t("internalUse.cols.code"),
      required: true,
      width: "150px",
      render: (row) => <span className="font-mono font-semibold text-primary-600">{row.code}</span>,
    },
    {
      key: "reason",
      label: isVi ? "Loại xuất" : t("internalUse.reason"),
      defaultVisible: true,
      render: (row) => <span className="text-slate-700 dark:text-slate-200">{row.reason ?? "—"}</span>,
    },
    {
      key: "cost",
      label: isVi ? "Tổng giá trị" : t("internalUse.cols.cost"),
      defaultVisible: true,
      align: "right",
      cellClassName: "font-mono font-bold text-warn",
      render: (row) => formatCurrency(row.totalCost),
    },
    {
      key: "date",
      label: isVi ? "Thời gian" : t("orders.cols.date"),
      defaultVisible: true,
      width: "180px",
      render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "warehouse",
      label: isVi ? "Chi nhánh" : "Branch",
      defaultVisible: true,
      render: (row) => <span className="text-slate-700 dark:text-slate-200">{row.warehouseName ?? "—"}</span>,
    },
    {
      key: "note",
      label: t("internalUse.note"),
      defaultVisible: true,
      render: (row) => <span className="text-slate-500">{row.note ?? "—"}</span>,
    },
    {
      key: "status",
      label: isVi ? "Trạng thái" : t("orders.cols.status"),
      defaultVisible: true,
      width: "130px",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <section>
      <DataTableShell
        tableId="inventory.internal-use"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        minWidth="1120px"
        empty={(
          <div className="rounded-card border border-dashed border-border bg-surface px-4 py-14 text-center text-slate-400">
            <LayoutList className="mx-auto mb-3 h-10 w-10 opacity-60" />
            <p className="font-medium">{t("internalUse.empty")}</p>
          </div>
        )}
        rowClassName={(row) => cn(row.status === "pending" && "bg-warn-soft/25")}
        renderDetail={(row) => <ExpandedIssue row={row} />}
      />
    </section>
  );
}

function ExpandedIssue({ row }: { row: InternalUseRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const isVi = locale === "vi";
  const totalQty = row.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  return (
    <div className="bg-surface px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-extrabold">{row.code}</h3>
            <StatusBadge status={row.status} />
          </div>
          <div className="mt-3 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2 xl:grid-cols-4">
            <Info label={isVi ? "Người tạo" : "Created by"} value={row.createdByName ?? "—"} />
            <Info label={isVi ? "Loại xuất" : t("internalUse.reason")} value={row.reason ?? "—"} />
            <Info label={isVi ? "Người nhận" : t("internalUse.department")} value={row.department ?? "—"} />
            <Info label={isVi ? "Ngày xuất" : t("orders.cols.date")} value={formatDate(row.createdAt)} />
          </div>
        </div>
        <div className="text-right text-sm font-semibold text-slate-500">{row.warehouseName ?? "—"}</div>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="inventory-internal-use-items">
          {row.items.map((item) => (
            <article key={item.id} className="space-y-2 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-words font-semibold">{item.productName}</div>
                  <div className="mt-0.5 font-mono text-xs text-primary-600">{item.sku ?? "—"}</div>
                </div>
                <div className="shrink-0 font-bold tabular-nums">{formatCurrency(item.total)}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                <span>{formatNumber(item.quantity)} {item.unitName}</span>
                <span className="text-right">{formatCurrency(item.unitCost)} / {item.unitName}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-34" />
            <col />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-34" />
            <col className="w-34" />
          </colgroup>
          <thead>
            <tr className="bg-canvas text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
              <th className="px-3 py-3">{isVi ? "Mã hàng" : "SKU"}</th>
              <th className="px-3 py-3">{isVi ? "Tên hàng" : "Product"}</th>
              <th className="px-3 py-3">{isVi ? "ĐVT" : "Unit"}</th>
              <th className="px-3 py-3 text-right">{isVi ? "SL xuất" : "Qty"}</th>
              <th className="px-3 py-3 text-right">{t("internalUse.unitCost")}</th>
              <th className="px-3 py-3 text-right">{t("internalUse.lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {row.items.map((item) => (
              <tr key={item.id} className="hover:bg-surface-2/70">
                <td className="px-3 py-3 font-mono font-semibold text-primary-600">{item.sku ?? "—"}</td>
                <td className="truncate px-3 py-3 font-medium">{item.productName}</td>
                <td className="px-3 py-3">{item.unitName}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">{formatNumber(item.quantity)}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">{formatCurrency(item.unitCost)}</td>
                <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-h-24 rounded-card border border-border bg-canvas px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          {row.note ?? (isVi ? "Không có ghi chú" : "No note")}
        </div>
        <div className="rounded-card bg-canvas px-4 py-3 text-sm">
          <SummaryLine label={isVi ? "Tổng số lượng" : "Total quantity"} value={formatNumber(totalQty)} />
          <SummaryLine label={isVi ? "Tổng giá trị" : "Total value"} value={formatCurrency(row.totalCost)} strong />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
        <div className="flex flex-wrap items-center gap-4">
          <TextAction><Copy className="h-4 w-4" />{isVi ? "Sao chép" : "Copy"}</TextAction>
          <TextAction><FileDown className="h-4 w-4" />{isVi ? "Xuất file" : "Export"}</TextAction>
        </div>
        <div className="flex items-center gap-2">
          <SmallAction><Save className="h-4 w-4" />{isVi ? "Lưu" : "Save"}</SmallAction>
          <SmallAction><Printer className="h-4 w-4" />{isVi ? "In" : "Print"}</SmallAction>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  const normalized = status === "pending" ? "pending" : "approved";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", normalized === "pending" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
      {normalized === "pending" ? t("internalUse.status.pending") : t("internalUse.status.approved")}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={cn("font-mono tabular-nums", strong && "font-extrabold text-foreground")}>{value}</span>
    </div>
  );
}

function TextAction({ children }: { children: React.ReactNode }) {
  return <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-slate-600 transition hover:text-primary-700 dark:text-slate-300 lg:min-h-0 lg:px-0">{children}</button>;
}

function SmallAction({ children }: { children: React.ReactNode }) {
  return <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-border bg-surface px-3 text-sm font-semibold text-slate-600 transition hover:bg-surface-2 dark:text-slate-200 lg:min-h-9">{children}</button>;
}
