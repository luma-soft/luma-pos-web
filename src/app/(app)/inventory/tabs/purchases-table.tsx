"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, Copy, FilePenLine, Printer, ReceiptText } from "lucide-react";
import { PurchaseCancelButton } from "../../purchases/purchase-cancel-button";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { getPurchases } from "@/lib/data/inventory";

type PurchaseRow = Awaited<ReturnType<typeof getPurchases>>["rows"][number];

function statusClass(status: string) {
  if (status === "cancelled") return "bg-er-soft text-er";
  if (status === "returned" || status === "draft") return "bg-warn-soft text-warn";
  return "bg-ok-soft text-ok";
}

function purchaseOwed(purchase: PurchaseRow) {
  if (purchase.status === "cancelled") return 0;
  return Math.max(0, Number(purchase.total) - Number(purchase.amountPaid));
}

export function PurchasesTable({ rows }: { rows: PurchaseRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<PurchaseRow>[] = [
    { key: "code", label: t("purchases.cols.code"), required: true, render: (purchase) => <span className="font-semibold text-primary-600">{purchase.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (purchase) => <span className="text-slate-500">{formatDate(purchase.createdAt)}</span> },
    { key: "supplier", label: t("purchases.cols.supplier"), defaultVisible: true, render: (purchase) => purchase.supplierName },
    { key: "warehouse", label: t("purchases.cols.warehouse"), defaultVisible: true, render: (purchase) => <span className="text-slate-500">{purchase.warehouseName}</span> },
    { key: "total", label: t("orders.cols.total"), defaultVisible: true, align: "right", cellClassName: "font-semibold", render: (purchase) => formatCurrency(Number(purchase.total)) },
    { key: "owed", label: t("purchases.cols.owed"), defaultVisible: true, align: "right", cellClassName: (purchase) => purchaseOwed(purchase) > 0 ? "font-semibold text-warn" : "text-slate-400", render: (purchase) => purchaseOwed(purchase) > 0 ? formatCurrency(purchaseOwed(purchase)) : "—" },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (purchase) => <StatusBadge status={purchase.status} /> },
  ];
  return (
    <DataTableShell
      tableId="inventory.purchases"
      rows={rows}
      columns={columns}
      getRowId={(purchase) => purchase.id}
      minWidth="1080px"
      renderExpanded={(purchase) => <ExpandedPurchase purchase={purchase} />}
      renderMobileRow={({ row: purchase, expanded, toggle }) => {
        const owed = purchaseOwed(purchase);
        return (
          <>
            <button type="button" onClick={toggle} className="w-full p-3 text-left">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-primary-600">{purchase.code}</div>
                  <div className="text-xs text-slate-400">{formatDate(purchase.createdAt)} · {purchase.supplierName}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={purchase.status} />
                  <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", expanded && "rotate-180")} />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-semibold tabular-nums">{formatCurrency(Number(purchase.total))}</span>
                {owed > 0 && <span className="font-semibold tabular-nums text-warn">{formatCurrency(owed)}</span>}
              </div>
            </button>
          </>
        );
      }}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass(status))}>
      {t(`purchases.status.${status}` as never)}
    </span>
  );
}

function ExpandedPurchase({
  purchase,
  compact = false,
}: {
  purchase: PurchaseRow;
  compact?: boolean;
}) {
  const t = useTranslations();
  const total = Number(purchase.total);
  const paid = Number(purchase.amountPaid);
  const owed = purchaseOwed(purchase);
  const canChange = purchase.status === "received" || purchase.status === "draft";
  const printHref = `${Routes.purchase(purchase.id)}/print`;

  return (
    <div className={cn("border-t border-border-soft bg-surface px-4 py-4", compact && "px-3")}>
      <div className={cn("grid gap-4", compact ? "grid-cols-1" : "lg:grid-cols-[1fr_320px]")}>
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{t("purchases.detail.items", { count: purchase.items.length })}</div>
              <div className="text-xs text-slate-400">{purchase.supplierName}</div>
            </div>
            <ReceiptText className="h-5 w-5 text-slate-400" />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-3 py-2.5 font-semibold">{t("products.fields.sku")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t("purchases.cols.qty")}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t("purchases.cols.unitCost")}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t("orders.cols.discount")}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {purchase.items.map((item) => {
                  const discount = Number(item.discount);
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-3">
                        <Link href={Routes.product(item.productId)} className="font-medium text-primary-600 hover:underline">
                          {item.sku}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-slate-400">{item.baseUnit}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitCost))}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                        {discount > 0 ? formatCurrency(discount) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {purchase.note && (
            <div className="rounded-lg bg-canvas px-3 py-2.5 text-sm">
              <div className="mb-1 text-xs font-medium text-slate-500">{t("purchases.detail.note")}</div>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{purchase.note}</p>
            </div>
          )}
        </div>

        <div className="space-y-3 text-sm">
          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("purchases.detail.info")}</div>
            <InfoLine label={t("purchases.cols.supplier")}>
              <Link href={Routes.supplier(purchase.supplierId)} className="font-medium text-primary-600 hover:underline">
                {purchase.supplierName}
              </Link>
            </InfoLine>
            {purchase.supplierPhone && <InfoLine label={t("customers.phone")} value={purchase.supplierPhone} />}
            <InfoLine label={t("purchases.cols.warehouse")} value={purchase.warehouseName} />
            <InfoLine label={t("orders.cols.date")} value={formatDate(purchase.createdAt)} />
            {purchase.createdByName && <InfoLine label={t("purchases.detail.receiver")} value={purchase.createdByName} />}
            {purchase.invoiceNumber && <InfoLine label={t("purchases.invoiceNumber")} value={purchase.invoiceNumber} />}
          </div>

          <div className="space-y-2 rounded-lg border border-border-soft p-3">
            <div className="font-semibold">{t("purchases.detail.payment")}</div>
            <InfoLine label={t("purchases.subtotal")} value={formatCurrency(Number(purchase.subtotal))} />
            {Number(purchase.discount) > 0 && (
              <InfoLine label={t("pos.discount")} value={`- ${formatCurrency(Number(purchase.discount))}`} valueClassName="text-ok" />
            )}
            {Number(purchase.tax) > 0 && (
              <InfoLine label={`VAT ${formatNumber(Number(purchase.vatRate))}%`} value={formatCurrency(Number(purchase.tax))} />
            )}
            <InfoLine label={t("orders.cols.total")} value={formatCurrency(total)} valueClassName="text-primary-600 text-base" strong />
            <InfoLine label={t("purchases.amountPaid")} value={formatCurrency(paid)} />
            <InfoLine
              label={t("purchases.cols.owed")}
              value={formatCurrency(owed)}
              valueClassName={owed > 0 ? "text-warn" : "text-ok"}
              strong
            />
          </div>

        </div>
      </div>

      <div className={cn("mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3", compact && "items-stretch")}>
        <div className="flex flex-wrap items-center gap-2">
          {canChange && <PurchaseCancelButton purchaseId={purchase.id} compact />}
          {canChange && (
            <Link href={Routes.purchaseCopy(purchase.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-slate-600 hover:bg-surface-2">
              <Copy className="h-3.5 w-3.5" />
              {t("purchases.copy")}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={printHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-primary-600 hover:bg-surface-2">
            <Printer className="h-3.5 w-3.5" />
            {t("print.printBtn")}
          </Link>
          {canChange && (
            <Link href={Routes.purchaseEdit(purchase.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:brightness-110">
              <FilePenLine className="h-3.5 w-3.5" />
              {t("purchases.edit")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoLine({
  label,
  value,
  children,
  valueClassName,
  strong,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  valueClassName?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-right tabular-nums", strong && "font-semibold", valueClassName)}>
        {children ?? value ?? "—"}
      </span>
    </div>
  );
}
