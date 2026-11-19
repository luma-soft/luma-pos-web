"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Banknote, Building2, ChevronRight, CircleUserRound, Landmark, Package, TrendingUp } from "lucide-react";
import { compactMoney } from "@/app/(app)/partners/tabs/customer-mobile";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type Range = "today" | "week" | "month";
type Summary = {
  summary: { revenue: number; cost: number };
  receivables: { unpaid: number; count: number };
  payables: { unpaid: number; count: number };
  cashMovement: { cash: { in: number; out: number }; bank: { in: number; out: number } };
  topCustomers: Array<{ customerId: string | null; name: string; remaining?: number; revenue?: number; orderCount: number }>;
};

/** NativeFinanceSummaryView on phones: range control, metric tiles, cash movement and customers with debt. */
export function FinanceSummaryMobile() {
  const t = useTranslations("mobile.finance");
  const [range, setRange] = useState<Range>("month");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/mobile/finance?range=${range}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error("load failed");
        setData(json.data as Summary);
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [range, attempt]);

  const tile = (title: string, value: string, subtitle: string, Icon: typeof TrendingUp, tint: string, bg: string) => (
    <div className={cn("min-h-[126px] rounded-[15px] border border-black/[0.06] p-3", bg)}>
      <div className={cn("flex items-center gap-2 text-[12px] font-semibold", tint)}><Icon className="size-4" aria-hidden="true" />{title}</div>
      <div className="mt-2 text-[20px] font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-ios-label-secondary">{subtitle}</div>
    </div>
  );
  const movement = (label: string, Icon: typeof Banknote, value: { in: number; out: number }) => (
    <div className="flex items-center gap-3 border-b border-border py-3">
      <Icon className="size-5 shrink-0 text-ios-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[15px] font-semibold">{label}</span>
      <span className="text-right text-[12px] font-bold tabular-nums">
        <span className="block text-ios-green">+{compactMoney(value.in)}</span>
        <span className="block text-ios-red">−{compactMoney(value.out)}</span>
      </span>
    </div>
  );

  return (
    <div className="space-y-5 pb-6 lg:hidden">
      <div className="grid grid-cols-3 rounded-full bg-ios-accent/10 p-1">
        {(["today", "week", "month"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setRange(key)} data-button-radius="pill"
            className={cn("min-h-10 rounded-full text-[15px] font-medium", range === key ? "bg-ios-accent text-white" : "text-ios-label")}>
            {t(`range.${key}`)}
          </button>
        ))}
      </div>
      {error && (
        <div className="flex items-center gap-3 rounded-[14px] bg-ios-orange/10 px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1 font-semibold">{t("loadError")}</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-ios-accent">{t("retry")}</button>
        </div>
      )}
      {!data ? (
        !error && <div className="grid grid-cols-2 gap-2" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[126px] animate-pulse rounded-[15px] bg-black/[0.06]" />)}</div>
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-[17px] text-ios-label-secondary">{t("metrics")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {tile(t("revenue"), compactMoney(data.summary.revenue), t("recognized"), TrendingUp, "text-ios-accent", "bg-ios-accent/[0.08]")}
              {tile(t("cost"), compactMoney(data.summary.cost), t("fromOrderLines"), Package, "text-ios-orange", "bg-ios-orange/[0.08]")}
              {tile(t("receivables"), compactMoney(data.receivables.unpaid), t("ordersCount", { count: data.receivables.count }), CircleUserRound, "text-ios-accent", "bg-ios-accent/[0.08]")}
              {tile(t("payables"), compactMoney(data.payables.unpaid), t("purchasesCount", { count: data.payables.count }), Landmark, "text-ios-red", "bg-ios-red/[0.08]")}
            </div>
          </section>
          <section>
            <h3 className="mb-1 text-[17px] text-ios-label-secondary">{t("cashMovement")}</h3>
            {movement(t("cash"), Banknote, data.cashMovement.cash)}
            {movement(t("bank"), Building2, data.cashMovement.bank)}
          </section>
          <section>
            <h3 className="mb-1 text-[17px] text-ios-label-secondary">{t("receivableContext")}</h3>
            {data.topCustomers.filter((c) => Number(c.remaining ?? 0) > 0).slice(0, 5).map((customer) => (
              <Link key={`${customer.customerId}-${customer.name}`}
                href={customer.customerId ? `${Routes.Partners}?tab=customers&detailCustomerId=${customer.customerId}` : Routes.Partners}
                className="flex items-center gap-3 border-b border-border py-3">
                <CircleUserRound className="size-6 shrink-0 text-ios-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ios-accent">{customer.name}</span>
                  <span className="block text-[12px] text-ios-label-secondary">{t("ordersCount", { count: customer.orderCount })}</span>
                </span>
                <span className="text-[15px] font-bold tabular-nums text-ios-accent">{compactMoney(Number(customer.remaining ?? 0))}</span>
                <ChevronRight className="size-4 text-ios-label-tertiary" aria-hidden="true" />
              </Link>
            ))}
            {!data.topCustomers.some((c) => Number(c.remaining ?? 0) > 0) && <p className="py-4 text-[15px] text-ios-label-secondary">{t("noCustomers")}</p>}
          </section>
        </>
      )}
    </div>
  );
}
