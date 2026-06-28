"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTableShell, type DataTableColumn } from "@/components/data-table";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { StockFilter } from "@/lib/data/inventory";

type StockRow = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  costPrice: string | number;
  totalStock: string | number;
  minLevel: string | number;
  stockValue: string | number;
};

type Sev = "out" | "crit" | "warn" | "ok";

const SEV_BAR: Record<Sev, string> = { out: "bg-er", crit: "bg-er", warn: "bg-warn", ok: "bg-primary-500" };

export function stockSev(stock: number, min: number): Sev {
  if (stock <= 0) return "out";
  if (min > 0 && stock <= min) return "crit";
  if (min > 0 && stock <= min * 1.5) return "warn";
  return "ok";
}

export function StockTable({ rows }: { rows: StockRow[]; stock?: StockFilter }) {
  const t = useTranslations();
  const columns: DataTableColumn<StockRow>[] = [
    { key: "product", label: t("orders.cols.product"), required: true, render: (row) => <span><span className="font-medium">{row.name}</span><span className="ml-2 text-xs text-slate-400">{row.sku}</span></span> },
    { key: "stock", label: t("inventory.cols.stock"), defaultVisible: true, align: "right", cellClassName: (row) => stockClass(row), render: (row) => `${formatNumber(Number(row.totalStock))} ${row.baseUnit}` },
    { key: "min", label: t("inventory.cols.min"), defaultVisible: true, align: "right", render: (row) => Number(row.minLevel) > 0 ? formatNumber(Number(row.minLevel)) : "—" },
    { key: "level", label: t("inventory.cols.level"), defaultVisible: true, width: "140px", render: (row) => <Level row={row} /> },
    { key: "value", label: t("inventory.cols.value"), defaultVisible: true, align: "right", render: (row) => formatCurrency(Number(row.stockValue)) },
    { key: "cost", label: t("products.list.colCost"), defaultVisible: false, align: "right", render: (row) => formatCurrency(Number(row.costPrice)) },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <StatusBadge sev={stockSev(Number(row.totalStock), Number(row.minLevel))} /> },
  ];
  return (
    <DataTableShell
      tableId="inventory.stock"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="980px"
      renderExpanded={(row) => {
        const sev = stockSev(Number(row.totalStock), Number(row.minLevel));
        return (
          <div className="space-y-4 bg-surface px-4 py-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Info label={t("orders.cols.product")} value={row.name} />
              <Info label={t("products.fields.sku")} value={row.sku} />
              <Info label={t("inventory.cols.stock")} value={`${formatNumber(Number(row.totalStock))} ${row.baseUnit}`} tone={sev === "crit" || sev === "out" ? "danger" : undefined} />
              <Info label={t("inventory.cols.value")} value={formatCurrency(Number(row.stockValue))} />
            </div>
            <div className="flex justify-end">
              <Link href={Routes.product(row.id)} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold text-primary-600 hover:bg-surface-2">
                Mở hàng hóa
              </Link>
            </div>
          </div>
        );
      }}
    />
  );
}

function stockClass(row: StockRow) {
  const sev = stockSev(Number(row.totalStock), Number(row.minLevel));
  return cn("font-bold", (sev === "crit" || sev === "out") && "text-er");
}

function Level({ row }: { row: StockRow }) {
  const stock = Number(row.totalStock);
  const min = Number(row.minLevel);
  const sev = stockSev(stock, min);
  const pct = min > 0 ? Math.min(100, Math.round((stock / (min * 2)) * 100)) : (stock > 0 ? 100 : 0);
  return <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full", SEV_BAR[sev])} style={{ width: `${pct}%` }} /></div>;
}

function StatusBadge({ sev }: { sev: Sev }) {
  const t = useTranslations();
  const map: Record<Sev, { cls: string; key: string }> = {
    out: { cls: "bg-er-soft text-er", key: "inventory.statusOut" },
    crit: { cls: "bg-er-soft text-er", key: "inventory.statusLow" },
    warn: { cls: "bg-warn-soft text-warn", key: "inventory.statusWarn" },
    ok: { cls: "bg-ok-soft text-ok", key: "inventory.statusOk" },
  };
  const item = map[sev];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", item.cls)}>{t(item.key as never)}</span>;
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "danger" && "text-er")}>{value}</div>
    </div>
  );
}
