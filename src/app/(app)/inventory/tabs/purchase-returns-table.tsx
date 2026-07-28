"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { getPurchaseReturns } from "@/lib/data/purchase-returns";

type PurchaseReturnRow = Awaited<ReturnType<typeof getPurchaseReturns>>["rows"][number];

function statusClass(status: string) {
  if (status === "draft") return "bg-warn-soft text-warn";
  return "bg-ok-soft text-ok";
}

function settlementClass(status: string) {
  if (status === "settled") return "text-ok";
  if (status === "partial") return "text-warn";
  return "text-slate-400";
}

export function PurchaseReturnsTable({ rows }: { rows: PurchaseReturnRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<PurchaseReturnRow>[] = [
    { key: "code", label: t("purchaseReturns.cols.code"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "time", label: t("purchaseReturns.cols.time"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "supplier", label: t("purchaseReturns.cols.supplier"), defaultVisible: true, render: (row) => row.supplierName },
    { key: "subtotal", label: t("purchaseReturns.cols.subtotal"), defaultVisible: true, align: "right", render: (row) => formatCurrency(Number(row.subtotal)) },
    { key: "discount", label: t("purchaseReturns.cols.discount"), defaultVisible: true, align: "right", render: (row) => Number(row.discount) > 0 ? formatCurrency(Number(row.discount)) : "—" },
    { key: "tax", label: t("purchaseReturns.cols.tax"), defaultVisible: true, align: "right", render: (row) => Number(row.tax) > 0 ? formatCurrency(Number(row.tax)) : "—" },
    { key: "totalRefund", label: t("purchaseReturns.cols.totalRefund"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (row) => formatCurrency(Number(row.totalRefund)) },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTableShell
      tableId="inventory.purchaseReturns"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1180px"
      renderDetail={(row) => <ExpandedPurchaseReturn row={row} />}
      detailSize="full"
      renderMobileRow={({ row, toggle }) => (
        <button type="button" onClick={toggle} className="w-full p-3 text-left min-h-11">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-primary-600">{row.code}</div>
              <div className="text-xs text-slate-400">{formatDate(row.createdAt)} · {row.supplierName}</div>
            </div>
            <StatusBadge status={row.status} />
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="font-semibold tabular-nums">{formatCurrency(Number(row.totalRefund))}</span>
            <span className={cn("text-xs font-semibold", settlementClass(row.settlementStatus))}>{t(`purchaseReturns.settlement.${row.settlementStatus}` as never)}</span>
          </div>
        </button>
      )}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass(status))}>
      {t(`purchaseReturns.status.${status}` as never)}
    </span>
  );
}

function ExpandedPurchaseReturn({ row }: { row: PurchaseReturnRow }) {
  const t = useTranslations();
  return (
    <div className="border-t border-border-soft bg-surface px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="divide-y divide-border-soft overflow-hidden rounded-lg border border-border lg:hidden" data-mobile-audit="inventory-purchase-return-items">
          {row.items.map((item) => (
            <article key={item.id} className="space-y-2 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={Routes.product(item.productId)}
                  className="inline-flex min-h-11 flex-1 items-center break-words font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-11"
                >
                  {item.productName}
                </Link>
                <div className="shrink-0 font-semibold tabular-nums">{formatCurrency(Number(item.total))}</div>
              </div>
              <div className="text-xs text-slate-500">{item.sku} · {formatNumber(Number(item.quantity))} {item.unitName}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span>{t("purchaseReturns.cols.unitCost")}: <b className="tabular-nums">{formatCurrency(Number(item.unitCost))}</b></span>
                <span className="text-right">{t("purchaseReturns.cols.returnUnitCost")}: <b className="tabular-nums">{formatCurrency(Number(item.returnUnitCost))}</b></span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-3 py-2.5 font-semibold">{t("products.fields.sku")}</th>
                <th className="px-3 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t("purchaseReturns.cols.qty")}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t("purchaseReturns.cols.unitCost")}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t("purchaseReturns.cols.returnUnitCost")}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {row.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3">
                    <Link href={Routes.product(item.productId)} className="font-medium text-primary-600 hover:underline">{item.sku}</Link>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{item.productName}</div>
                    <div className="text-xs text-slate-400">{item.unitName}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitCost))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.returnUnitCost))}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 rounded-lg border border-border-soft p-3 text-sm">
          <Info label={t("purchaseReturns.cols.supplier")} value={row.supplierName} />
          <Info label={t("purchases.cols.warehouse")} value={row.warehouseName} />
          <Info label={t("purchaseReturns.refundAmount")} value={formatCurrency(Number(row.refundAmount))} />
          <Info label={t("purchaseReturns.debtAmount")} value={formatCurrency(Number(row.debtAmount))} />
          <Info label={t("purchaseReturns.settlementLabel")} value={t(`purchaseReturns.settlement.${row.settlementStatus}` as never)} />
          {row.createdByName && <Info label={t("purchases.detail.receiver")} value={row.createdByName} />}
          {row.note && <Info label={t("purchases.detail.note")} value={row.note} />}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
