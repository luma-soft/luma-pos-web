"use client";

import { useMobileLoadMore, type LoadMoreSource } from "@/components/mobile-load-more";
import { useState, type ReactNode } from "react";
import { usePhoneLayout } from "@/components/use-phone-layout";
import { MobileStocktakeDetail } from "./stocktake-mobile";
import { useTranslations } from "next-intl";
import { ListChecks } from "lucide-react";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { StocktakeRowActions } from "../../stocktakes/stocktake-actions";
import { StocktakeDetail } from "./stocktake-detail";
import { StocktakeDetailActions } from "./stocktake-detail-actions";

export type StocktakeRow = {
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
  productSummary: string;
  netValue: string | number | null;
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-warn-soft text-warn",
  balanced: "bg-ok-soft text-ok",
  cancelled: "bg-surface-2 text-slate-500",
};

/** NativeStocktakeListItem: checklist tile, product summary, SKU count, date · code, status, differences. */
export function StocktakeMobileRow({
  row,
  renderActions,
  onOpen,
}: {
  row: StocktakeRow;
  renderActions: (row: StocktakeRow) => ReactNode;
  onOpen: () => void;
}) {
  const t = useTranslations();
  const totalDiff = Number(row.totalDiff);
  const netValue = row.netValue === null ? null : Number(row.netValue);
  const tone = row.status === "draft" ? "text-ios-orange bg-ios-orange/12" : row.status === "balanced" ? "text-ios-green bg-ios-green/12" : "text-ios-label-secondary bg-black/[0.06]";
  const valueTone = (value: number) => value === 0 ? "text-ios-label-secondary" : value > 0 ? "text-ios-green" : "text-ios-red";
  const actions = renderActions(row);
  return (
    <article className={cn("min-w-0 space-y-3 rounded-[18px] border border-border bg-surface p-4", row.status === "cancelled" && "opacity-60")}>
      <button type="button" onClick={onOpen} aria-label={`${t("stocktakes.viewDetails")} ${row.code}`} className="block w-full space-y-2.5 text-left">
        <span className="flex items-center gap-3">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-[12px]", tone)}>
            <ListChecks className="size-[18px]" strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block truncate text-[17px] font-semibold leading-[22px]">{row.productSummary?.trim() || t("mobile.stocktakes.defaultTitle")}</span>
            <span className="block text-[12px] text-ios-label-secondary">{formatNumber(row.itemCount)} SKU</span>
            <span className="block truncate text-[11px] text-ios-label-tertiary">{shortDateTime(row.createdAt)} · {row.code}</span>
          </span>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-semibold leading-none", tone)}>{t(`stocktakes.status.${row.status}` as never)}</span>
        </span>
        <span className="flex items-baseline gap-2 text-[12px] tabular-nums">
          <span className={cn("min-w-0 flex-1 font-medium", valueTone(totalDiff))}>{t("mobile.stocktakes.totalDiff")}: {diffText(totalDiff)}</span>
          {netValue !== null && <span className={cn("shrink-0 font-semibold", valueTone(netValue))}>{t("mobile.stocktakes.valueDiff")}: {formatCurrency(netValue)}</span>}
        </span>
      </button>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </article>
  );
}

function shortDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function StocktakesTable({
  rows: serverRows,
  loadMore,
  fillHeight = true,
  canCancelBalanced = false,
  canViewValues = false,
}: {
  rows: StocktakeRow[];
  /** Phones: append further pages automatically (desktop keeps pagination). */
  loadMore?: LoadMoreSource<StocktakeRow>;
  fillHeight?: boolean;
  canCancelBalanced?: boolean;
  canViewValues?: boolean;
}) {
  const { rows, footer: loadMoreFooter } = useMobileLoadMore(serverRows, loadMore, (row) => row.id);
  const t = useTranslations();
  const phone = usePhoneLayout();
  const [openId, setOpenId] = useState<string | null>(null);
  const openRow = phone ? rows.find((row) => row.id === openId) ?? null : null;
  const columns: DataTableColumn<StocktakeRow>[] = [
    { key: "code", label: t("stocktakes.cols.code"), required: true, render: (row) => <span className="font-semibold text-primary-600">{row.code}</span> },
    { key: "date", label: t("orders.cols.date"), defaultVisible: true, render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
    { key: "items", label: t("stocktakes.cols.items"), defaultVisible: true, align: "right", render: (row) => row.itemCount },
    { key: "productSummary", label: t("stocktakes.cols.productSummary"), defaultVisible: true, render: (row) => <span className="block max-w-64 truncate text-slate-600" title={row.productSummary}>{row.productSummary || "—"}</span> },
    { key: "diff", label: t("stocktakes.cols.totalDiff"), defaultVisible: true, align: "right", cellClassName: (row) => diffClass(Number(row.totalDiff)), render: (row) => diffText(Number(row.totalDiff)) },
    ...(canViewValues ? [{ key: "netValue", label: t("stocktakes.summary.netValue"), defaultVisible: true, align: "right" as const, cellClassName: (row: StocktakeRow) => row.netValue === null ? "text-slate-400" : diffClass(Number(row.netValue)), render: (row: StocktakeRow) => row.netValue === null ? "—" : formatCurrency(Number(row.netValue)) }] : []),
    { key: "balancedAt", label: t("stocktakes.cols.balancedAt"), defaultVisible: true, render: (row) => <span className="text-slate-500">{row.balancedAt ? formatDate(row.balancedAt) : "—"}</span> },
    { key: "status", label: t("orders.cols.status"), defaultVisible: true, render: (row) => <Status row={row} /> },
    { key: "actions", label: "", required: true, width: "90px", align: "right", render: (row) => <span onClick={stopRowToggle}><StocktakeRowActions id={row.id} status={row.status} /></span> },
  ];
  return (
    <>
    <DataTableShell
      tableId="inventory.stocktakes"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      fillHeight={fillHeight}
      maxHeight={fillHeight ? undefined : "none"}
      minHeight={fillHeight ? 280 : 0}
      rowClassName={(row) => cn(row.status === "cancelled" && "opacity-60")}
      mobileListClassName="max-lg:space-y-ios-section"
      mobileRowClassName="max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none"
      renderMobileRow={({ row }) => (
        <StocktakeMobileRow
          row={row}
          // Phones push the native-style detail instead of the modal.
          onOpen={() => setOpenId(row.id)}
          // Only drafts have row actions (balance / cancel) on phones.
          renderActions={(actionRow) => actionRow.status === "draft"
            ? <StocktakeRowActions id={actionRow.id} status={actionRow.status} />
            : null}
        />
      )}
      clientSideDetailNavigation
      renderDetail={(row) => (
        <StocktakeDetail stocktakeId={row.id} status={row.status} />
      )}
      detailFooter={(row) => <StocktakeDetailActions id={row.id} status={row.status} canCancelBalanced={canCancelBalanced} />}
      detailTitle={(row) => row.code}
      detailSubtitle={(row) => `${formatDate(row.createdAt)} · ${t(`stocktakes.status.${row.status}` as never)}`}
      detailPanelClassName="h-[min(88dvh,780px)] w-[min(96vw,1200px)] sm:max-w-none"
    />
    {loadMoreFooter}
    {openRow && (
      <MobileStocktakeDetail id={openRow.id} code={openRow.code} status={openRow.status} canCancelBalanced={canCancelBalanced} onBack={() => setOpenId(null)} />
    )}
    </>
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
