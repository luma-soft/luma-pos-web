"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PackagePlus } from "lucide-react";
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
type StockExpandTab = "info" | "stock";

const SEV_BAR: Record<Sev, string> = { out: "bg-er", crit: "bg-er", warn: "bg-warn", ok: "bg-primary-500" };
const STOCK_EXPAND_TABS: StockExpandTab[] = ["info", "stock"];

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
      renderDetail={(row) => <ExpandedStock row={row} />}
    />
  );
}

function ExpandedStock({ row }: { row: StockRow }) {
  const t = useTranslations();
  const [tab, setTab] = useState<StockExpandTab>("info");
  const stock = Number(row.totalStock);
  const min = Number(row.minLevel);
  const sev = stockSev(stock, min);

  return (
    <div className="border-t border-border-soft bg-surface px-4 py-4">
      <div className="flex items-center gap-6 overflow-x-auto border-b border-border-soft text-sm font-semibold text-slate-500">
        {STOCK_EXPAND_TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 px-2 transition-colors lg:min-h-0 lg:min-w-0 lg:pb-2",
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`inventory.expand.tabs.${key}` as never)}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {tab === "info" && (
          <div className="space-y-4">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
                {row.name}
              </h3>
              <div className="mt-1 text-sm text-slate-500">
                {t("products.fields.sku")}: {row.sku}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge sev={sev} />
                <Badge text={t("inventory.expand.stockManaged" as never)} tone={sev === "ok" ? "ok" : "muted"} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
              <InfoItem label={t("orders.cols.product")} value={row.name} />
              <InfoItem label={t("products.fields.sku")} value={row.sku} />
              <InfoItem label={t("products.list.colCost")} value={formatCurrency(Number(row.costPrice))} />
              <InfoItem label={t("inventory.cols.value")} value={formatCurrency(Number(row.stockValue))} />
            </div>
          </div>
        )}

        {tab === "stock" && (
          <>
          <div className="rounded-lg border border-border p-3 lg:hidden" data-mobile-audit="inventory-stock-location">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{t("products.expand.defaultWarehouse")}</div>
                <div className={cn("mt-1 text-sm font-semibold tabular-nums", (sev === "crit" || sev === "out") && "text-er")}>
                  {formatNumber(stock)} {row.baseUnit}
                </div>
              </div>
              <StatusBadge sev={sev} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <InfoItem label={t("inventory.cols.min")} value={min > 0 ? formatNumber(min) : "—"} />
              <div><div className="text-slate-500">{t("inventory.cols.level")}</div><div className="mt-2"><Level row={row} /></div></div>
            </div>
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3 font-semibold">{t("products.expand.cols.warehouse")}</th>
                  <th className="px-3 py-3 text-right font-semibold">{t("products.expand.cols.stock")}</th>
                  <th className="px-3 py-3 text-right font-semibold">{t("inventory.cols.min")}</th>
                  <th className="px-3 py-3 font-semibold">{t("inventory.cols.level")}</th>
                  <th className="px-3 py-3 font-semibold">{t("products.expand.cols.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                <tr>
                  <td className="px-3 py-3 font-medium">{t("products.expand.defaultWarehouse")}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", (sev === "crit" || sev === "out") && "text-er")}>
                    {formatNumber(stock)} {row.baseUnit}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {min > 0 ? formatNumber(min) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Level row={row} />
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge sev={sev} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <div className="border-t border-border-soft pt-4 mt-4">
        <div className="flex flex-wrap justify-end gap-2">
          <ActionLink href={Routes.purchaseNewForProduct(row.id)} icon={PackagePlus} label={t("products.actions.purchase")} />
          <Link
            href={Routes.product(row.id)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-primary-600 bg-primary-600 px-3 text-sm font-semibold text-white transition-colors hover:border-primary-700 hover:bg-primary-700 lg:min-h-10 min-w-11 lg:min-w-0"
          >
            {t("inventory.expand.openProduct" as never)}
          </Link>
        </div>
      </div>
    </div>
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

function InfoItem({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="border-b border-border-soft pb-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 min-h-5 text-sm font-medium text-slate-800 dark:text-slate-100", tone === "danger" && "text-er")}>{value || "—"}</div>
    </div>
  );
}

function Badge({ text, tone = "muted" }: { text: string; tone?: "muted" | "ok" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
        tone === "ok" ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-700 dark:text-slate-200",
      )}
    >
      {text}
    </span>
  );
}

function ActionLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof PackagePlus;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-surface-2 dark:text-slate-200 lg:min-h-10 min-w-11 lg:min-w-0"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
