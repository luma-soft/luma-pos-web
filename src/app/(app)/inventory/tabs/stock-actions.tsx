"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ClipboardCheck, Filter, History, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export type MovementItem = {
  id: string;
  type: string;
  quantity: number;
  createdAt: string;
  productName: string;
  baseUnit: string;
  warehouseName: string;
  byName: string | null;
  note: string | null;
};

const MOVE_STYLES: Record<string, string> = {
  purchase: "text-ok", sale: "text-er", return_in: "text-in", return_out: "text-warn",
  transfer: "text-in", adjust: "text-warn", init: "text-slate-500", internal_use: "text-warn",
};

export function StockActionMenu() {
  const t = useTranslations();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", closeKey); };
  }, [open]);

  return (
    <div ref={root} className="relative ml-auto flex items-center gap-2">
      <Link
        href={`${Routes.Inventory}?tab=stock#stock-history`}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-primary-700 shadow-e1 transition hover:bg-surface-2 dark:text-primary-300"
      >
        <History className="h-4 w-4" />
        {t("inventory.actions.history")}
      </Link>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-slate-700 shadow-e1 transition hover:bg-surface-2 dark:text-slate-200">
        <ClipboardCheck className="h-4 w-4 text-primary-600" />
        {t("inventory.actions.warehouseActions")}
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
      </button>
      <Link href={Routes.PurchaseNew} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary-600 px-4 text-sm font-semibold text-white transition hover:bg-primary-700 active:scale-[0.98] lg:min-h-10">
        <Plus className="h-4 w-4" />{t("purchases.createNew")}
      </Link>
      {open && (
        <div role="menu" className="absolute right-[152px] top-[calc(100%+8px)] z-40 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-e3">
          <Link role="menuitem" href={Routes.StocktakeNew} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2" onClick={() => setOpen(false)}>
            <ClipboardCheck className="mt-0.5 h-4 w-4 text-primary-600" />
            <span><span className="block text-sm font-semibold">{t("stocktakes.createNew")}</span><span className="mt-0.5 block text-xs text-slate-400">{t("inventory.actions.startStocktakeHint")}</span></span>
          </Link>
          <Link role="menuitem" href={`${Routes.Inventory}?tab=stocktakes`} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2" onClick={() => setOpen(false)}>
            <History className="mt-0.5 h-4 w-4 text-slate-500" />
            <span><span className="block text-sm font-semibold">{t("inventory.actions.viewStocktakes")}</span><span className="mt-0.5 block text-xs text-slate-400">{t("inventory.actions.viewStocktakesHint")}</span></span>
          </Link>
        </div>
      )}
    </div>
  );
}

export function RecentMovements({ movements }: { movements: MovementItem[] }) {
  const t = useTranslations();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [warehouse, setWarehouse] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const warehouses = useMemo(() => Array.from(new Set(movements.map((item) => item.warehouseName))), [movements]);
  const types = useMemo(() => Array.from(new Set(movements.map((item) => item.type))), [movements]);
  const filtered = useMemo(() => movements.filter((item) => {
    const matchQuery = !query.trim() || `${item.productName} ${item.id} ${item.note ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchQuery && (type === "all" || item.type === type) && (warehouse === "all" || item.warehouseName === warehouse);
  }), [movements, query, type, warehouse]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (!drawerOpen) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  return (
    <>
      <section
        id="stock-history"
        className="min-w-0 scroll-mt-32 overflow-hidden rounded-card border border-border bg-surface shadow-e1"
        data-layout="inventory-history-table"
        data-mobile-audit="inventory-recent-movements"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="text-base font-bold">{t("inventory.movementsTitle")}</h2>
          <button type="button" onClick={() => setDrawerOpen(true)} className="text-xs font-semibold text-primary-700 hover:underline">{t("inventory.actions.viewAll")}</button>
        </div>
        {movements.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">{t("inventory.noMovements")}</p>
        ) : (
          <>
            <div className="divide-y divide-border-soft lg:hidden">
              {movements.slice(0, 5).map((movement) => (
                <article key={movement.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{movement.productName}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-400">
                      <span>{t(`inventory.moveTypes.${movement.type}` as never)}</span>
                      <span>{movement.warehouseName}</span>
                    </div>
                  </div>
                  <div className={cn("text-right font-mono text-sm font-bold", MOVE_STYLES[movement.type] ?? "text-slate-600")}>
                    <div>{movement.quantity > 0 ? "+" : ""}{formatNumber(movement.quantity)} {movement.baseUnit}</div>
                    <div className="mt-1 text-[11px] font-normal text-slate-400">{formatDate(movement.createdAt)}</div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] text-[15px]">
                <thead className="bg-canvas/65 text-left text-sm font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{t("inventory.historyColumns.time")}</th>
                    <th className="px-4 py-3">{t("inventory.historyColumns.product")}</th>
                    <th className="px-4 py-3">{t("inventory.historyColumns.change")}</th>
                    <th className="px-4 py-3">{t("inventory.historyColumns.type")}</th>
                    <th className="px-4 py-3">{t("inventory.historyColumns.warehouse")}</th>
                    <th className="px-4 py-3">{t("inventory.historyColumns.actor")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {movements.slice(0, 5).map((movement) => (
                    <tr key={movement.id} className="hover:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300">
                        {formatDate(movement.createdAt)}
                      </td>
                      <td className="max-w-[360px] px-4 py-4">
                        <div className="truncate font-semibold" title={movement.productName}>{movement.productName}</div>
                        <div className="mt-0.5 font-mono text-xs text-slate-400">#{movement.id.slice(0, 8).toUpperCase()}</div>
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-4 font-mono font-bold tabular-nums", MOVE_STYLES[movement.type] ?? "text-slate-600")}>
                        {movement.quantity > 0 ? "+" : ""}{formatNumber(movement.quantity)} {movement.baseUnit}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">{t(`inventory.moveTypes.${movement.type}` as never)}</td>
                      <td className="whitespace-nowrap px-4 py-4">{movement.warehouseName}</td>
                      <td className="whitespace-nowrap px-4 py-4">{movement.byName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {drawerOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-950/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDrawerOpen(false); }}>
          <aside role="dialog" aria-modal="true" aria-label={t("inventory.movementsTitle")} className="ml-auto flex h-full w-full max-w-[720px] flex-col bg-surface shadow-2xl">
            <header className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/40"><History className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><h2 className="text-lg font-bold">{t("inventory.movementsTitle")}</h2><p className="text-xs text-slate-400">{t("inventory.actions.ledgerSubtitle")}</p></div>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t("common.close")} className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-surface-2"><X className="h-5 w-5" /></button>
            </header>
            <div className="grid gap-2 border-b border-border bg-canvas/60 p-4 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
              <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("inventory.actions.searchMovements")} className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary-500" /></label>
              <label className="relative"><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm outline-none"><option value="all">{t("inventory.actions.allTypes")}</option>{types.map((value) => <option key={value} value={value}>{t(`inventory.moveTypes.${value}` as never)}</option>)}</select></label>
              <label className="relative"><SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><select value={warehouse} onChange={(event) => { setWarehouse(event.target.value); setPage(1); }} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-9 pr-8 text-sm outline-none"><option value="all">{t("inventory.actions.allWarehouses")}</option>{warehouses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto"><MovementList rows={pageRows} /></div>
            <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-sm"><span className="text-slate-500">{t("inventory.actions.showing", { count: filtered.length })}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40">{t("inventory.actions.previous")}</button><span className="min-w-14 text-center font-mono text-xs">{page}/{pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold disabled:opacity-40">{t("inventory.actions.next")}</button></div></footer>
          </aside>
        </div>
      )}
    </>
  );
}

function MovementList({ rows, compact = false }: { rows: MovementItem[]; compact?: boolean }) {
  const t = useTranslations();
  return <div className={cn("divide-y divide-border-soft", compact && "max-h-[520px] overflow-auto")}>{rows.map((movement) => <article key={movement.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-surface-2"><div className="min-w-0"><div className="truncate text-sm font-semibold" title={movement.productName}>{movement.productName}</div><div className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-400"><span className="font-mono">#{movement.id.slice(0, 8).toUpperCase()}</span><span>{t(`inventory.moveTypes.${movement.type}` as never)}</span><span>{movement.warehouseName}</span></div></div><div className={cn("text-right font-mono text-sm font-bold tabular-nums", MOVE_STYLES[movement.type] ?? "text-slate-600")}><div>{movement.quantity > 0 ? "+" : ""}{formatNumber(movement.quantity)} {movement.baseUnit}</div><div className="mt-1 text-[11px] font-normal text-slate-400">{formatDate(movement.createdAt)}</div></div></article>)}</div>;
}
