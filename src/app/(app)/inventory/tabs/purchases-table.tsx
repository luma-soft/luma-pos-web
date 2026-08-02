"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy, FilePenLine, ReceiptText } from "lucide-react";
import { PurchaseCancelButton } from "../../purchases/purchase-cancel-button";
import { DataTableShell, RowPreviewModal, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { getPurchases } from "@/lib/data/inventory";
import type { PrintTemplate } from "@/lib/print/template-shared";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";

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

export function PurchasesTable({ rows, printTemplates }: { rows: PurchaseRow[]; printTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[] }) {
  const t = useTranslations();
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRow | null>(null);
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
    <>
      <DataTableShell
        tableId="inventory.purchases"
        rows={rows}
        columns={columns}
        getRowId={(purchase) => purchase.id}
        minWidth="1080px"
        onRowClick={setSelectedPurchase}
        renderMobileRow={({ row: purchase }) => {
          const owed = purchaseOwed(purchase);
          return (
            <button type="button" onClick={() => setSelectedPurchase(purchase)} className="w-full p-3 text-left min-h-11">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-primary-600">{purchase.code}</div>
                  <div className="text-xs text-slate-400">{formatDate(purchase.createdAt)} · {purchase.supplierName}</div>
                </div>
                <StatusBadge status={purchase.status} />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-semibold tabular-nums">{formatCurrency(Number(purchase.total))}</span>
                {owed > 0 && <span className="font-semibold tabular-nums text-warn">{formatCurrency(owed)}</span>}
              </div>
            </button>
          );
        }}
      />

      <RowPreviewModal
        open={Boolean(selectedPurchase)}
        onClose={() => setSelectedPurchase(null)}
        title={selectedPurchase?.code ?? ""}
        subtitle={selectedPurchase && (
          <span className="inline-flex items-center gap-2">
            <span>{formatDate(selectedPurchase.createdAt)}</span>
            <StatusBadge status={selectedPurchase.status} />
          </span>
        )}
        bodyClassName="flex flex-col !overflow-hidden"
        footer={selectedPurchase && <PurchaseDetailFooter purchase={selectedPurchase} printTemplates={printTemplates} />}
      >
        {selectedPurchase && <PurchaseDetailContent purchase={selectedPurchase} />}
      </RowPreviewModal>
    </>
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

function PurchaseDetailContent({ purchase }: { purchase: PurchaseRow }) {
  const t = useTranslations();
  const total = Number(purchase.total);
  const paid = Number(purchase.amountPaid);
  const owed = purchaseOwed(purchase);

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,1fr)_auto] gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-1">
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{t("purchases.detail.items", { count: purchase.items.length })}</div>
            <div className="text-xs text-slate-400">{purchase.supplierName}</div>
          </div>
          <ReceiptText className="h-5 w-5 text-slate-400" />
        </div>
        <div className="min-h-0 flex-1 divide-y divide-border-soft overflow-auto overscroll-contain rounded-lg border border-border lg:hidden" data-mobile-audit="inventory-purchase-items">
          {purchase.items.map((item) => {
            const discount = Number(item.discount);
            return (
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
                <div className="text-xs text-slate-500">{item.sku} · {formatNumber(Number(item.quantity))} {item.baseUnit}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span>{t("purchases.cols.unitCost")}: <b className="tabular-nums">{formatCurrency(Number(item.unitCost))}</b></span>
                  <span className="text-right">{t("orders.cols.discount")}: <b className="tabular-nums">{discount > 0 ? formatCurrency(discount) : "—"}</b></span>
                </div>
              </article>
            );
          })}
        </div>
        <div className="hidden min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border border-border lg:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10">
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
          <div className="shrink-0 rounded-lg bg-canvas px-3 py-2.5 text-sm">
            <div className="mb-1 text-xs font-medium text-slate-500">{t("purchases.detail.note")}</div>
            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{purchase.note}</p>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:block lg:space-y-3">
        <div className="space-y-2 rounded-lg border border-border-soft p-3">
          <div className="font-semibold">{t("purchases.detail.info")}</div>
          <InfoLine label={t("purchases.cols.supplier")}>
            <Link href={Routes.supplier(purchase.supplierId)} className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">
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
  );
}

function PurchaseDetailFooter({ purchase, printTemplates }: { purchase: PurchaseRow; printTemplates: Pick<PrintTemplate, "id" | "name" | "paperDefault">[] }) {
  const t = useTranslations();
  const canChange = purchase.status === "received" || purchase.status === "draft";
  const printHref = `${Routes.purchase(purchase.id)}/print`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canChange && <PurchaseCancelButton purchaseId={purchase.id} compact className="min-h-11 lg:min-h-8" />}
        {canChange && (
          <Link href={Routes.purchaseCopy(purchase.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-slate-600 hover:bg-surface-2 lg:min-h-8 min-w-11 lg:min-w-0">
            <Copy className="h-3.5 w-3.5" />
            {t("purchases.copy")}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PrintTemplateMenu baseHref={printHref} templates={printTemplates} label={t("print.printBtn")} className="min-h-11 min-w-11 rounded-lg border border-border px-3 text-xs font-semibold text-primary-600 hover:bg-surface-2 lg:min-h-8 lg:min-w-0" />
        {canChange && (
          <Link href={Routes.purchaseEdit(purchase.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:brightness-110 lg:min-h-8 min-w-11 lg:min-w-0">
            <FilePenLine className="h-3.5 w-3.5" />
            {t("purchases.edit")}
          </Link>
        )}
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
