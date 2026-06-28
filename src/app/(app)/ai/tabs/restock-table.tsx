"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatNumber } from "@/lib/utils";
import type { RestockPriority } from "@/lib/data/ai-restock";

type RestockRow = {
  id: string;
  name: string;
  sku: string;
  baseUnit: string;
  stock: number;
  velocity: number;
  daysOfStock: number | null;
  suggestedQty: number;
  priority: RestockPriority;
};

const PILL: Record<RestockPriority, string> = {
  high: "bg-er-soft text-er",
  medium: "bg-warn-soft text-warn",
  low: "bg-ok-soft text-ok",
};

export function RestockTable({ rows }: { rows: RestockRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<RestockRow>[] = [
    { key: "product", label: t("orders.cols.product"), required: true, render: (row) => <span><span className="font-medium">{row.name}</span><span className="ml-2 text-xs text-slate-400">{row.sku}</span></span> },
    { key: "onHand", label: t("ai.cols.onHand"), defaultVisible: true, align: "right", render: (row) => `${formatNumber(row.stock)} ${row.baseUnit}` },
    { key: "velocity", label: t("ai.cols.velocity"), defaultVisible: true, align: "right", render: (row) => `${row.velocity.toFixed(1)}/${t("ai.perDay")}` },
    { key: "daysLeft", label: t("ai.cols.daysLeft"), defaultVisible: true, align: "right", cellClassName: (row) => row.daysOfStock != null && row.daysOfStock < 7 ? "font-bold text-er" : row.daysOfStock != null && row.daysOfStock < 14 ? "font-bold text-warn" : "text-slate-500", render: (row) => row.daysOfStock != null ? row.daysOfStock.toFixed(1) : "—" },
    { key: "suggested", label: t("ai.cols.suggested"), defaultVisible: true, align: "right", cellClassName: "font-bold text-primary-600", render: (row) => row.suggestedQty > 0 ? `+${formatNumber(row.suggestedQty)}` : "—" },
    { key: "priority", label: t("ai.cols.priority"), defaultVisible: true, render: (row) => <Priority row={row} /> },
    { key: "actions", label: "", required: true, width: "120px", align: "right", render: (row) => row.suggestedQty > 0 ? <Link onClick={stopRowToggle} href={Routes.PurchaseNew} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"><Truck className="h-3.5 w-3.5" />{t("ai.createPo")}</Link> : null },
  ];
  return (
    <DataTableShell
      tableId="ai.restock"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1040px"
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("orders.cols.product")} value={row.name} />
          <Info label={t("ai.cols.onHand")} value={`${formatNumber(row.stock)} ${row.baseUnit}`} />
          <Info label={t("ai.cols.velocity")} value={`${row.velocity.toFixed(1)}/${t("ai.perDay")}`} />
          <Info label={t("ai.cols.suggested")} value={row.suggestedQty > 0 ? `+${formatNumber(row.suggestedQty)}` : "—"} />
        </div>
      )}
    />
  );
}

function Priority({ row }: { row: RestockRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", PILL[row.priority])}>{t(`ai.priority.${row.priority}`)}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
