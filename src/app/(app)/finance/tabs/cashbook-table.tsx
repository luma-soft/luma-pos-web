"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { getCashbook } from "@/lib/data/cashbook";

type CashbookRow = Awaited<ReturnType<typeof getCashbook>>["rows"][number];

const CAT_STYLES: Record<string, string> = {
  sale: "bg-ok-soft text-ok",
  debt_collect: "bg-ok-soft text-ok",
  supplier_payment: "bg-er-soft text-er",
  refund: "bg-warn-soft text-warn",
  expense: "bg-warn-soft text-warn",
  other: "bg-surface-2 text-slate-600",
};

export function CashbookTable({ rows }: { rows: CashbookRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<CashbookRow>[] = [
    { key: "code", label: t("cashbook.cols.code"), required: true, render: (row) => <span className="font-medium text-primary-600">{row.code}</span> },
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
    <DataTableShell
      tableId="finance.cashbook"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="940px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("cashbook.cols.code")} value={row.code} />
          <Info label={t("orders.cols.date")} value={formatDate(row.createdAt)} />
          <Info label={t("cashbook.cols.fund")} value={row.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")} />
          <Info label={t("cashbook.cols.amount")} value={`${row.type === "in" ? "+" : "-"} ${formatCurrency(Number(row.amount))}`} tone={row.type === "in" ? "ok" : "er"} />
          <div className="md:col-span-4"><Info label={t("cashbook.cols.note")} value={row.note ?? "—"} /></div>
        </div>
      )}
    />
  );
}

function Category({ row }: { row: CashbookRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", CAT_STYLES[row.category] ?? CAT_STYLES.other)}>{t(`cashbook.categories.${row.category}` as never)}</span>;
}

function Note({ row }: { row: CashbookRow }) {
  if (row.refType === "order" && row.refId) return <Link href={Routes.order(row.refId)} className="text-primary-600 hover:underline">{row.note}</Link>;
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
