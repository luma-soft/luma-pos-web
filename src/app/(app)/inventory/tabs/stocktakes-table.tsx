"use client";

import { useTranslations } from "next-intl";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { StocktakeRowActions } from "../../stocktakes/stocktake-actions";

type StocktakeRow = {
  id: string;
  code: string;
  status: string;
  note: string | null;
  createdAt: Date | string;
  balancedAt: Date | string | null;
  warehouseName: string;
  byName: string | null;
  itemCount: number;
  totalDiff: string | number;
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-warn-soft text-warn",
  balanced: "bg-ok-soft text-ok",
  cancelled: "bg-surface-2 text-slate-500",
};

export function StocktakesTable({ rows }: { rows: StocktakeRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<StocktakeRow>[] = [
    { key: "code", label: t("stocktakes.cols.code"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "warehouse", label: t("purchases.cols.warehouse"), defaultVisible: true, render: (row) => row.warehouseName },
    { key: "items", label: t("stocktakes.cols.items"), defaultVisible: true, align: "right", render: (row) => row.itemCount },
    { key: "diff", label: t("stocktakes.cols.totalDiff"), defaultVisible: true, align: "right", cellClassName: (row) => diffClass(Number(row.totalDiff)), render: (row) => diffText(Number(row.totalDiff)) },
    { key: "balancedAt", label: t("stocktakes.cols.balancedAt"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.balancedAt ? formatDate(row.balancedAt) : "—"}</span> },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <Status row={row} /> },
    { key: "actions", label: "", required: true, width: "90px", align: "right", render: (row) => <span onClick={stopRowToggle}><StocktakeRowActions id={row.id} status={row.status} /></span> },
  ];
  return (
    <DataTableShell
      tableId="inventory.stocktakes"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      rowClassName={(row) => cn(row.status === "cancelled" && "opacity-60")}
      renderExpanded={(row) => (
        <div className="grid gap-4 bg-surface px-4 py-4 md:grid-cols-4">
          <Info label={t("stocktakes.cols.code")} value={row.code} />
          <Info label={t("purchases.cols.warehouse")} value={row.warehouseName} />
          <Info label={t("stocktakes.cols.items")} value={String(row.itemCount)} />
          <Info label={t("stocktakes.cols.totalDiff")} value={diffText(Number(row.totalDiff))} tone={diffTone(Number(row.totalDiff))} />
          <Info label={t("orders.cols.date")} value={formatDate(row.createdAt)} />
          <Info label={t("stocktakes.cols.balancedAt")} value={row.balancedAt ? formatDate(row.balancedAt) : "—"} />
          <Info label={t("internalUse.cols.by")} value={row.byName ?? "—"} />
          <Info label={t("customers.fields.note")} value={row.note ?? "—"} />
        </div>
      )}
    />
  );
}

function diffText(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function diffTone(value: number): "ok" | "er" | undefined {
  if (value > 0) return "ok";
  if (value < 0) return "er";
  return undefined;
}

function diffClass(value: number) {
  const tone = diffTone(value);
  return cn("font-semibold", tone === "ok" && "text-ok", tone === "er" && "text-er", !tone && "text-slate-400");
}

function Status({ row }: { row: StocktakeRow }) {
  const t = useTranslations();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[row.status])}>{t(`stocktakes.status.${row.status}` as never)}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "ok" | "er" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "ok" && "text-ok", tone === "er" && "text-er")}>{value}</div>
    </div>
  );
}
