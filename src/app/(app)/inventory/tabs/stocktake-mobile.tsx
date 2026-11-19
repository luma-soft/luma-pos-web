"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Copy, Printer, Scale, Trash2 } from "lucide-react";
import { MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { balanceStocktake, cancelStocktake } from "@/lib/actions/stocktakes";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type DetailData = {
  status: string;
  note: string | null;
  createdAt: string;
  balancedAt: string | null;
  warehouseName: string;
  byName: string | null;
  canViewValues: boolean;
  items: Array<{
    id: string;
    productId?: string;
    productName: string;
    sku: string;
    baseUnit: string;
    systemQty: string | number;
    actualQty: string | number;
    costPrice: string | number | null;
  }>;
};

function shortDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value)}`;
const toneOf = (value: number) => value > 0 ? "text-ios-green" : value < 0 ? "text-ios-red" : "";

function statusTone(status: string) {
  return status === "draft" ? "text-ios-orange" : status === "balanced" ? "text-ios-green" : "text-ios-label-secondary";
}

/** Two-column info tile of the native stocktake detail. */
function Tile({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-h-[94px] rounded-[18px] border border-border bg-surface px-3.5 py-3.5">
      <div className="text-[13px] text-ios-label-secondary">{label}</div>
      <div className={cn("mt-1.5 text-[17px] font-semibold tabular-nums [overflow-wrap:anywhere]", className)}>{children}</div>
    </div>
  );
}

/**
 * Stocktake detail pushed on phones (NativeStocktakeDetailView): header card,
 * information and summary tiles, per-item cards, and the "…" menu.
 */
export function MobileStocktakeDetail({
  id,
  code,
  status,
  canCancelBalanced,
  onBack,
}: {
  id: string;
  code: string;
  status: string;
  canCancelBalanced: boolean;
  onBack: () => void;
}) {
  const t = useTranslations("mobile.stocktakes");
  const tRoot = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const canCancel = status === "draft" || (status === "balanced" && canCancelBalanced);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/inventory/stocktakes/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { ok: boolean; data?: DetailData };
        if (!response.ok || !result.ok || !result.data) throw new Error("load failed");
        setData(result.data);
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id, status, attempt]);

  async function balance() {
    if (!await dialog.confirm({ description: tRoot("stocktakes.balanceConfirm"), confirmLabel: t("balance"), variant: "warning" })) return;
    const result = await balanceStocktake(id);
    if (!result.ok) return void dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
    router.refresh();
  }

  async function cancel() {
    if (!await dialog.confirm({
      description: tRoot(status === "balanced" ? "stocktakes.cancelBalancedConfirm" : "stocktakes.cancelConfirm"),
      confirmLabel: t("cancel"),
      variant: "destructive",
    })) return;
    const result = await cancelStocktake(id);
    if (!result.ok) return void dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
    onBack();
    router.refresh();
  }

  const summary = (data?.items ?? []).reduce((total, item) => {
    const diff = Number(item.actualQty) - Number(item.systemQty);
    if (Math.abs(diff) > 1e-9) total.differentProducts += 1;
    if (data?.canViewValues) {
      const value = diff * Number(item.costPrice ?? 0);
      if (value > 0) total.increase += value;
      if (value < 0) total.decrease += Math.abs(value);
      total.net += value;
    }
    return total;
  }, { differentProducts: 0, increase: 0, decrease: 0, net: 0 });
  const statusLabel = tRoot(`stocktakes.status.${status}` as never);

  return (
    <MobilePushedScreen
      title={code}
      onBack={onBack}
      actions={(
        <div className="space-y-2">
          {status === "draft" && <MenuAction icon={Scale} label={t("balance")} onSelect={() => void balance()} />}
          <MenuAction icon={Copy} label={t("copy")} onSelect={() => router.push(Routes.stocktakeCopy(id))} />
          <MenuAction icon={Printer} label={t("print")} onSelect={() => router.push(Routes.stocktakePrint(id))} />
          {canCancel && <MenuAction icon={Trash2} label={t("cancel")} destructive onSelect={() => void cancel()} />}
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <div className="rounded-[26px] bg-surface px-4 py-4">
          <h2 className="text-[22px] font-bold leading-7 [overflow-wrap:anywhere]">{code}</h2>
          <div className="mt-2 flex items-center gap-2.5">
            <span className={cn("rounded-full px-2.5 py-1.5 text-[13px] font-semibold leading-none", statusTone(status), status === "draft" ? "bg-ios-orange/12" : status === "balanced" ? "bg-ios-green/12" : "bg-black/[0.06]")}>{statusLabel}</span>
            <span className="text-[15px] text-ios-label-secondary">{shortDateTime(data?.createdAt ?? null)}</span>
          </div>
        </div>

        {error ? (
          <div className="rounded-[18px] bg-surface px-4 py-6 text-center">
            <p className="text-[15px] text-ios-label-secondary">{t("loadError")}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-2 text-[15px] font-semibold text-ios-accent">{t("retry")}</button>
          </div>
        ) : !data ? (
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[94px] animate-pulse rounded-[18px] bg-surface" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Tile label={t("status")} className={statusTone(data.status)}>{tRoot(`stocktakes.status.${data.status}` as never)}</Tile>
              <Tile label={t("warehouse")}>{data.warehouseName}</Tile>
              <Tile label={t("createdBy")}>{data.byName ?? "—"}</Tile>
              <Tile label={t("date")}>{shortDateTime(data.createdAt)}</Tile>
              {data.balancedAt && <Tile label={t("balancedAt")}>{shortDateTime(data.balancedAt)}</Tile>}
            </div>
            {data.note && (
              <div className="rounded-[18px] border border-border bg-surface px-3.5 py-3.5">
                <div className="text-[13px] text-ios-label-secondary">{t("note")}</div>
                <p className="mt-1.5 whitespace-pre-wrap text-[15px]">{data.note}</p>
              </div>
            )}

            <h3 className="pt-2 text-[20px] font-bold">{t("detailTitle")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <Tile label={t("checked")}>{formatNumber(data.items.length)}</Tile>
              <Tile label={t("diffProducts")} className={summary.differentProducts ? "text-ios-orange" : ""}>{formatNumber(summary.differentProducts)}</Tile>
              {data.canViewValues && (
                <>
                  <Tile label={t("valueIncrease")} className="text-ios-green">{formatCurrency(summary.increase)}</Tile>
                  <Tile label={t("valueDecrease")} className="text-ios-red">{formatCurrency(summary.decrease)}</Tile>
                  <Tile label={t("netValue")} className={toneOf(summary.net)}>{formatCurrency(summary.net)}</Tile>
                </>
              )}
            </div>

            <div className="space-y-ios-section">
              {data.items.map((item) => {
                const diff = Number(item.actualQty) - Number(item.systemQty);
                const value = diff * Number(item.costPrice ?? 0);
                const body = (
                  <>
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-semibold leading-[22px]">{item.productName}</span>
                        <span className="mt-1 block text-[15px] text-ios-label-secondary">{item.sku}</span>
                      </span>
                      {item.productId && <ChevronRight className="mt-0.5 size-4 shrink-0 text-ios-label-tertiary" strokeWidth={2.4} aria-hidden="true" />}
                    </span>
                    <span className="mt-3 grid grid-cols-3 gap-2">
                      {([
                        [t("systemQty"), `${formatNumber(Number(item.systemQty))} ${item.baseUnit}`, ""],
                        [t("actualQty"), `${formatNumber(Number(item.actualQty))} ${item.baseUnit}`, ""],
                        [t("diffQty"), `${signed(diff)} ${item.baseUnit}`, toneOf(diff)],
                      ] as const).map(([label, text, tone]) => (
                        <span key={label} className="min-w-0">
                          <span className="block text-[13px] text-ios-label-secondary">{label}</span>
                          <span className={cn("mt-1 block text-[15px] font-medium tabular-nums", tone)}>{text}</span>
                        </span>
                      ))}
                    </span>
                    {data.canViewValues && (
                      <span className="mt-3 flex items-baseline justify-between gap-2">
                        <span className="text-[13px] text-ios-label-secondary">{t("lineValue")}</span>
                        <span className={cn("text-[15px] font-semibold tabular-nums", toneOf(value))}>{formatCurrency(value)}</span>
                      </span>
                    )}
                  </>
                );
                const className = "block rounded-[18px] border border-border bg-surface px-3.5 py-3.5";
                return item.productId
                  ? <Link key={item.id} href={Routes.product(item.productId)} className={cn(className, "active:bg-black/[0.03]")}>{body}</Link>
                  : <div key={item.id} className={className}>{body}</div>;
              })}
            </div>
          </>
        )}
      </div>
    </MobilePushedScreen>
  );
}
