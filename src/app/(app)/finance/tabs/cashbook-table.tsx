"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { OrderDetailLink } from "@/components/order-detail-link";
import { CancelFinancialVoucherButton } from "@/components/partners/cancel-financial-voucher-button";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getCashbook } from "@/lib/data/cashbook";

type CashbookRow = Awaited<ReturnType<typeof getCashbook>>["rows"][number];

const CAT_STYLES: Record<string, string> = {
  sale: "bg-ok-soft text-ok",
  debt_collect: "bg-ok-soft text-ok",
  supplier_payment: "bg-er-soft text-er",
  refund: "bg-warn-soft text-warn",
  expense: "bg-warn-soft text-warn",
  cancellation: "bg-surface-2 text-slate-600",
  other: "bg-surface-2 text-slate-600",
};

export function CashbookTable({ rows: serverRows, loadMore }: {
  rows: CashbookRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<CashbookRow>;
}) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const t = useTranslations();
  const router = useRouter();
  const columns: DataTableColumn<CashbookRow>[] = [
    { key: "code", label: t("cashbook.cols.code"), required: true, render: (row) => <span className="inline-flex items-center gap-2 font-medium text-primary-600">{row.code}{row.status === "cancelled" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{t("financialVoucherCancellation.cancelled")}</span>}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "category", label: t("cashbook.cols.category"), defaultVisible: true, render: (row) => <Category row={row} /> },
    { key: "note", label: t("cashbook.cols.note"), defaultVisible: true, render: (row) => <Note row={row} /> },
    { key: "fund", label: t("cashbook.cols.fund"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")}</span> },
    {
      key: "amount",
      label: t("cashbook.cols.amount"),
      defaultVisible: true,
      align: "right",
      cellClassName: (row) => row.type === "in" ? "font-semibold text-ok" : "font-semibold text-er",
      render: (row) => `${row.type === "in" ? "+" : "-"} ${formatCurrency(Number(row.amount))}`,
    },
  ];
  return (
    <>
    <DataTableShell
      tableId="finance.cashbook"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      mobileListClassName="max-lg:-mx-4 max-lg:space-y-0 max-lg:bg-transparent"
      mobileRowClassName="max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none"
      // Phones: NativeCashbookRow — tinted circle, counterparty, signed amount, category · note, date · code · fund.
      renderMobileRow={({ row, toggle }) => (
        <button type="button" onClick={toggle} aria-label={row.code} className="flex w-full items-start gap-3 pl-4 text-left active:bg-black/[0.04]">
          <span className={cn("mt-3 grid size-6 shrink-0 place-items-center rounded-full text-white", row.type === "in" ? "bg-ios-green" : "bg-ios-red")}>
            {row.type === "in" ? <ArrowDownLeft className="size-3.5" strokeWidth={3} aria-hidden="true" /> : <ArrowUpRight className="size-3.5" strokeWidth={3} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1 border-b border-border py-3 pr-4">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">
                {row.counterparty ?? "—"}
                {row.status === "cancelled" && <span className="ml-1.5 rounded-full bg-ios-orange/12 px-2 py-0.5 text-[11px] font-bold text-ios-orange">{t("financialVoucherCancellation.cancelled")}</span>}
              </span>
              <span className={cn("shrink-0 text-[15px] font-bold tabular-nums", row.type === "in" ? "text-ios-green" : "text-ios-red")}>
                {row.type === "in" ? "+" : "−"}{formatCurrency(Number(row.amount))}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 block text-[15px] text-ios-label-secondary">{t(`cashbook.categories.${row.category}` as never)} · {row.note ?? "—"}</span>
            <span className="mt-1 block truncate text-[12px] text-ios-label-tertiary">{formatDate(row.createdAt)} · {row.code} · {row.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")}</span>
          </span>
        </button>
      )}
      minWidth="940px"
      clientSideDetailNavigation
      renderDetail={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("cashbook.cols.code")} value={row.code} />
          <Info label={t("orders.cols.date")} value={formatDate(row.createdAt)} />
          <Info label={t("cashbook.cols.fund")} value={row.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")} />
          <Info label={t("cashbook.cols.amount")} value={`${row.type === "in" ? "+" : "-"} ${formatCurrency(Number(row.amount))}`} tone={row.type === "in" ? "ok" : "er"} />
          <Info label={t("financialVoucherCancellation.statusLabel")} value={row.status === "cancelled" ? t("financialVoucherCancellation.cancelled") : t("financialVoucherCancellation.confirmed")} />
          <Info label={row.type === "in" ? t("cashbook.payer") : t("cashbook.recipient")} value={row.counterparty ?? "—"} />
          <div className="md:col-span-4"><Info label={t("cashbook.cols.note")} value={row.note ?? "—"} /></div>
          {row.cancellationReason && <div className="md:col-span-4"><Info label={t("financialVoucherCancellation.reasonLabel")} value={row.cancellationReason} /></div>}
          <div className="md:col-span-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/cashbook/${row.id}/print`} target="_blank" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2">
                <Printer className="h-4 w-4" /> {t("cashbook.printVoucher")}
              </Link>
              {canCancelCashbookRow(row) && (
                <CancelFinancialVoucherButton
                  kind="cashbook"
                  transactionId={row.id}
                  code={row.code}
                  amount={Number(row.amount)}
                  onCancelled={() => router.refresh()}
                />
              )}
            </div>
          </div>
        </div>
      )}
    />
    {loadMoreFooter}
    </>
  );
}

function canCancelCashbookRow(row: CashbookRow) {
  if (row.status !== "confirmed") return false;
  if (row.refType === "manual") return true;
  return (row.refType === "customer_receivable_receipt" || row.refType === "supplier_payable_receipt") && Boolean(row.refId);
}

function Category({ row }: { row: CashbookRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", CAT_STYLES[row.category] ?? CAT_STYLES.other)}>{t(`cashbook.categories.${row.category}` as never)}</span>;
}

function Note({ row }: { row: CashbookRow }) {
  if (row.refType === "order" && row.refId) return <OrderDetailLink orderId={row.refId} className="inline-flex min-h-11 min-w-11 items-center text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">{row.note}</OrderDetailLink>;
  return <span className="text-slate-500">{row.note ?? "—"}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "ok" | "er" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "ok" && "text-ok", tone === "er" && "text-er")}>{value}</div>
    </div>
  );
}
