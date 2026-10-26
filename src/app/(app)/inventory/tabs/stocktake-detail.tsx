"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, RotateCw } from "lucide-react";
import { cn, formatDate, formatNumber } from "@/lib/utils";

type StocktakeDetailData = {
  status: string;
  note: string | null;
  createdAt: string;
  balancedAt: string | null;
  warehouseName: string;
  byName: string | null;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    baseUnit: string;
    systemQty: string | number;
    actualQty: string | number;
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

export function StocktakeDetail({ stocktakeId }: { stocktakeId: string }) {
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
  }, [attempt, stocktakeId]);

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

  const totalDiff = data.items.reduce(
    (total, item) => total + Number(item.actualQty) - Number(item.systemQty),
    0,
  );

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label={t("orders.cols.status")}>
          <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[data.status] ?? STATUS_STYLES.cancelled)}>
            {t(`stocktakes.status.${data.status}` as never)}
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

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-bold">{t("stocktakes.detail.linesTitle")}</h3>
          <span className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            totalDiff > 0 ? "text-ok" : totalDiff < 0 ? "text-er" : "text-slate-500",
          )}>
            {t("stocktakes.cols.totalDiff")}: {totalDiff > 0 ? "+" : ""}{formatNumber(totalDiff)}
          </span>
        </div>

        {data.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">
            {t("stocktakes.detail.emptyLines")}
          </p>
        ) : (
          <>
            <div className="divide-y divide-border-soft lg:hidden">
              {data.items.map((item) => <MobileLine key={item.id} item={item} />)}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border border-border-soft lg:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-canvas/70 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{t("orders.detail.items")}</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.systemQty")}</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.actualQty")}</th>
                    <th className="px-4 py-3 text-right">{t("stocktakes.cols.diff")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {data.items.map((item) => <DesktopLine key={item.id} item={item} />)}
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

function MobileLine({ item }: { item: StocktakeDetailData["items"][number] }) {
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
      </div>
    </article>
  );
}

function DesktopLine({ item }: { item: StocktakeDetailData["items"][number] }) {
  const systemQty = Number(item.systemQty);
  const actualQty = Number(item.actualQty);
  return (
    <tr className="hover:bg-surface-2/60">
      <td className="max-w-[320px] px-4 py-3">
        <div className="truncate font-semibold" title={item.productName}>{item.productName}</div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{item.sku}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNumber(systemQty)} {item.baseUnit}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">{formatNumber(actualQty)} {item.baseUnit}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right"><Diff value={actualQty - systemQty} unit={item.baseUnit} /></td>
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

function Diff({ value, unit }: { value: number; unit: string }) {
  const tone = value > 0 ? "text-ok" : value < 0 ? "text-er" : "text-slate-500";
  return (
    <span className={cn("whitespace-nowrap font-mono text-sm font-bold tabular-nums", tone)}>
      {value > 0 ? "+" : ""}{formatNumber(value)} {unit}
    </span>
  );
}
