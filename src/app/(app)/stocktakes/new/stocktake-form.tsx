"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Loader2, Save, Search, Trash2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { createStocktake } from "@/lib/actions/stocktakes";

interface ProductOption {
  id: string; sku: string; name: string; baseUnit: string; costPrice: number; stock: number;
}

interface Line {
  product: ProductOption;
  actualQty: number;
}

export function StocktakeForm({ activeWarehouseId, warehouses, products }: { activeWarehouseId: string; warehouses: { id: string; name: string }[]; products: ProductOption[] }) {
  const t = useTranslations();
  const router = useRouter();

  // tồn hệ thống hiển thị được load theo kho này — đổi kho sẽ reload trang
  const warehouseId = activeWarehouseId;
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"draft" | "balance" | null>(null);
  const [error, setError] = useState("");

  const added = useMemo(() => new Set(lines.map((l) => l.product.id)), [lines]);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => !added.has(p.id) && (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [search, products, added]);

  function addLine(p: ProductOption) {
    setLines((ls) => [...ls, { product: p, actualQty: p.stock }]);
    setSearch("");
  }

  function setQty(id: string, qty: number) {
    setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, actualQty: Math.max(0, qty) } : l)));
  }

  const totals = useMemo(() => {
    let matched = 0, diffCount = 0, diffQty = 0, diffValue = 0;
    for (const l of lines) {
      const d = l.actualQty - l.product.stock;
      if (Math.abs(d) < 1e-9) matched++;
      else {
        diffCount++;
        diffQty += d;
        diffValue += d * l.product.costPrice;
      }
    }
    return { matched, diffCount, diffQty, diffValue };
  }, [lines]);

  async function submit(balanceNow: boolean) {
    if (lines.length === 0 || busy) return;
    if (balanceNow && !confirm(t("stocktakes.balanceConfirm"))) return;
    setBusy(balanceNow ? "balance" : "draft");
    setError("");
    const res = await createStocktake({
      warehouseId,
      note: note || undefined,
      balanceNow,
      items: lines.map((l) => ({ productId: l.product.id, actualQty: l.actualQty })),
    });
    setBusy(null);
    if (res.ok) router.push(Routes.Stocktakes);
    else setError(t(res.error as never));
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={() => router.push(Routes.Stocktakes)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold">{t("stocktakes.createNew")}</h1>
        <div className="ml-auto">
          <select
            value={warehouseId}
            onChange={(e) => router.push(`${Routes.StocktakeNew}?wh=${e.target.value}`)}
            disabled={lines.length > 0}
            className="px-3 py-2 text-sm rounded-lg border border-border bg-surface disabled:opacity-60"
            title={lines.length > 0 ? t("stocktakes.warehouseLocked") : undefined}
          >
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      {/* search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("stocktakes.searchPlaceholder")}
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-card border border-border bg-surface"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-surface border border-slate-200 dark:border-slate-700 rounded-card shadow-lg overflow-hidden">
            {suggestions.map((p) => (
              <button
                key={p.id} onClick={() => addLine(p)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2 text-left"
              >
                <span><b>{p.name}</b> <span className="text-slate-400 text-xs">{p.sku}</span></span>
                <span className="text-slate-500 tabular-nums">{t("pos.stockLabel")}: {formatNumber(p.stock)} {p.baseUnit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* lines */}
      <div className="bg-surface border border-border rounded-card overflow-hidden mb-4">
        {lines.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">{t("stocktakes.noLines")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("orders.cols.product")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("stocktakes.cols.systemQty")}</th>
                <th className="px-4 py-3 font-semibold text-right w-36">{t("stocktakes.cols.actualQty")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("stocktakes.cols.diff")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("stocktakes.cols.diffValue")}</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {lines.map((l) => {
                const diff = l.actualQty - l.product.stock;
                return (
                  <tr key={l.product.id}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{l.product.name}</div>
                      <div className="text-xs text-slate-400">{l.product.sku} · {l.product.baseUnit}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatNumber(l.product.stock)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number" min={0} value={l.actualQty}
                        onChange={(e) => setQty(l.product.id, Number(e.target.value))}
                        className="w-28 px-2 py-1.5 text-right text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums"
                      />
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", diff > 0 ? "text-ok" : diff < 0 ? "text-er" : "text-slate-400")}>
                      {Math.abs(diff) < 1e-9 ? <Check className="w-4 h-4 inline text-emerald-500" /> : `${diff > 0 ? "+" : ""}${formatNumber(diff)}`}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", diff !== 0 ? (diff > 0 ? "text-ok" : "text-er") : "text-slate-400")}>
                      {diff !== 0 ? formatCurrency(diff * l.product.costPrice) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))} className="text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* summary + actions */}
      <div className="bg-surface border border-border rounded-card p-5 flex items-end justify-between flex-wrap gap-4">
        <div className="text-sm space-y-1 min-w-56">
          <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("stocktakes.summary.checked")}</span><b className="tabular-nums">{lines.length}</b></div>
          <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("stocktakes.summary.matched")}</span><b className="tabular-nums text-ok">{totals.matched}</b></div>
          <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("stocktakes.summary.diff")}</span><b className="tabular-nums text-warn">{totals.diffCount}</b></div>
          <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("stocktakes.cols.diffValue")}</span>
            <b className={cn("tabular-nums", totals.diffValue > 0 ? "text-ok" : totals.diffValue < 0 ? "text-er" : "")}>{formatCurrency(totals.diffValue)}</b>
          </div>
        </div>
        <div className="flex-1 min-w-60">
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("orders.detail.notePlaceholder")}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface"
          />
          {error && <p className="text-xs text-er mt-2">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => submit(false)} disabled={!!busy || lines.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium disabled:opacity-50"
          >
            {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("stocktakes.saveDraft")}
          </button>
          <button
            onClick={() => submit(true)} disabled={!!busy || lines.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy === "balance" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t("stocktakes.complete")}
          </button>
        </div>
      </div>
    </div>
  );
}
