"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, RotateCw } from "lucide-react";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";

type StocktakeDetailData = {
  status: string;
  note: string | null;
  createdAt: string;
  balancedAt: string | null;
  warehouseName: string;
  byName: string | null;
  canViewValues: boolean;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    baseUnit: string;
    systemQty: string | number;
    actualQty: string | number;
    costPrice: string | number | null;
  }>;
};

type StocktakeDetailResponse = {
  ok: boolean;
  data?: StocktakeDetailData;
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-warn-soft text-warn",
  balanced: "bg-ok-soft text-ok",
  cancelled: "bg-surface-2 text-slate-500",
};

export function StocktakeDetail({ stocktakeId, status }: { stocktakeId: string; status: string }) {
  const t = useTranslations();
  const [data, setData] = useState<StocktakeDetailData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "loaded">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`/api/inventory/stocktakes/${encodeURIComponent(stocktakeId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as StocktakeDetailResponse;
        if (!response.ok || !result.ok || !result.data) {
          throw new Error("Unable to load stocktake details");
        }
        setData(result.data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("error");
      });

    return () => controller.abort();
  }, [attempt, status, stocktakeId]);

  if (loadState === "loading") {
    return (
      <div className="space-y-5" aria-label={t("stocktakes.detail.loading")}>
        <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-primary-600" aria-hidden="true" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-[68px] animate-pulse rounded-lg bg-canvas" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-lg bg-canvas" />
          ))}
        </div>
      </div>
    );
  }

  if (loadState === "error" || !data) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-slate-500">{t("stocktakes.detail.loadError")}</p>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setAttempt((value) => value + 1);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-primary-700 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300"
        >
          <RotateCw className="h-4 w-4" />
          {t("stocktakes.detail.retry")}
        </button>
      </div>
    );
  }

  const summary = data.items.reduce((total, item) => {
    const diff = Number(item.actualQty) - Number(item.systemQty);
    total.totalDiff += diff;
    if (Math.abs(diff) > 1e-9) total.differentProducts += 1;
    if (data.canViewValues) {
      const value = diff * Number(item.costPrice ?? 0);
      if (value > 0) total.increaseValue += value;
      if (value < 0) total.decreaseValue += Math.abs(value);
      total.netValue += value;
    }
    return total;
  }, { totalDiff: 0, differentProducts: 0, increaseValue: 0, decreaseValue: 0, netValue: 0 });

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label={t("orders.cols.status")}>
          <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[status] ?? STATUS_STYLES.cancelled)}>
            {t(`stocktakes.status.${status}` as never)}
          </span>
        </Meta>
        <Meta label={t("inventory.warehouseLabel")} value={data.warehouseName} />
        <Meta label={t("internalUse.cols.by")} value={data.byName ?? "—"} />
        <Meta label={t("orders.cols.date")} value={formatDate(data.createdAt)} />
        <Meta label={t("stocktakes.cols.balancedAt")} value={data.balancedAt ? formatDate(data.balancedAt) : "—"} />
        <Meta label={t("stocktakes.cols.items")} value={formatNumber(data.items.length)} />
      </section>

      {data.note && (
        <section className="rounded-lg border border-border-soft bg-canvas/45 px-4 py-3">
          <div className="text-xs font-semibold text-slate-500">{t("customers.fields.note")}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{data.note}</p>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label={t("stocktakes.summary.checked")}>
        <SummaryMetric label={t("stocktakes.summary.checked")} value={formatNumber(data.items.length)} />
        <SummaryMetric label={t("stocktakes.summary.diffProducts")} value={formatNumber(summary.differentProducts)} tone={summary.differentProducts ? "warn" : undefined} />
        {data.canViewValues && (
          <>
            <SummaryMetric label={t("stocktakes.summary.valueIncrease")} value={formatCurrency(summary.increaseValue)} tone="ok" />
            <SummaryMetric label={t("stocktakes.summary.valueDecrease")} value={formatCurrency(summary.decreaseValue)} tone="er" />
            <SummaryMetric
              label={t("stocktakes.summary.netValue")}
              value={formatCurrency(summary.netValue)}
              tone={summary.netValue > 0 ? "ok" : summary.netValue < 0 ? "er" : undefined}
            />
          </>
        )}
      </section>
      {data.canViewValues && <p className="-mt-3 text-xs text-slate-400">{t("stocktakes.detail.valueBasis")}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-bold">{t("stocktakes.detail.linesTitle")}</h3>
          <span className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            summary.totalDiff > 0 ? "text-ok" : summary.totalDiff < 0 ? "text-er" : "text-slate-500",
          )}>
            {t("stocktakes.cols.totalDiff")}: {summary.totalDiff > 0 ? "+" : ""}{formatNumber(summary.totalDiff)}
          </span>
        </div>

        {data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">
            {t("stocktakes.detail.emptyLines")}
          </p>
        ) : (
          <>
            <div className="divide-y divide-border-soft lg:hidden">
              {data.items.map((item) => <MobileLine key={item.id} item={item} showValue={data.canViewValues} />)}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border border-border-soft lg:block">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-canvas/70 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{t("orders.detail.items")}</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.systemQty")}</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.actualQty")}</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.diff")}</th>
                    {data.canViewValues && <th className="px-4 py-3 text-right">{t("stocktakes.cols.diffValue")}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {data.items.map((item) => <DesktopLine key={item.id} item={item} showValue={data.canViewValues} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Meta({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface px-3 py-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{children ?? value ?? "—"}</div>
    </div>
  );
}

function MobileLine({ item, showValue }: { item: StocktakeDetailData["items"][number]; showValue: boolean }) {
  const t = useTranslations();
  const systemQty = Number(item.systemQty);
  const actualQty = Number(item.actualQty);
  const diff = actualQty - systemQty;
  return (
    <article className="py-4 first:pt-1 last:pb-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold">{item.productName}</div>
          <div className="mt-1 font-mono text-xs text-slate-500">{item.sku}</div>
        </div>
        <Diff value={diff} unit={item.baseUnit} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <Quantity label={t("stocktakes.cols.systemQty")} value={systemQty} unit={item.baseUnit} />
        <Quantity label={t("stocktakes.cols.actualQty")} value={actualQty} unit={item.baseUnit} />
        {showValue && <Money label={t("stocktakes.cols.diffValue")} value={diff * Number(item.costPrice ?? 0)} />}
      </div>
    </article>
  );
}

function DesktopLine({ item, showValue }: { item: StocktakeDetailData["items"][number]; showValue: boolean }) {
  const systemQty = Number(item.systemQty);
  const actualQty = Number(item.actualQty);
  const diff = actualQty - systemQty;
  const value = diff * Number(item.costPrice ?? 0);
  return (
    <tr className="hover:bg-surface-2/60">
      <td className="max-w-[320px] px-4 py-3">
        <div className="truncate font-semibold" title={item.productName}>{item.productName}</div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{item.sku}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNumber(systemQty)} {item.baseUnit}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNumber(actualQty)} {item.baseUnit}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right"><Diff value={diff} unit={item.baseUnit} /></td>
      {showValue && <td className={cn("whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums", value > 0 ? "text-ok" : value < 0 ? "text-er" : "text-slate-400")}>{formatCurrency(value)}</td>}
    </tr>
  );
}

function Quantity({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-md bg-canvas/70 px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-mono font-semibold tabular-nums">{formatNumber(value)} {unit}</div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: number }) {
  return (
    <div className="col-span-2 rounded-md bg-canvas/70 px-3 py-2">
      <div className="text-slate-500">{label}</div>
      <div className={cn("mt-1 font-mono font-semibold tabular-nums", value > 0 ? "text-ok" : value < 0 ? "text-er" : "text-slate-500")}>{formatCurrency(value)}</div>
    </div>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "er" | "warn" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface px-3 py-2.5">
      <div className="truncate text-xs font-semibold text-slate-500">{label}</div>
      <div className={cn("mt-1 truncate font-mono text-sm font-bold tabular-nums", tone === "ok" && "text-ok", tone === "er" && "text-er", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

function Diff({ value, unit }: { value: number; unit: string }) {
  const tone = value > 0 ? "text-ok" : value < 0 ? "text-er" : "text-slate-500";
  return (
    <span className={cn("whitespace-nowrap font-mono text-sm font-bold tabular-nums", tone)}>
      {value > 0 ? "+" : ""}{formatNumber(value)} {unit}
    </span>
  );
}
