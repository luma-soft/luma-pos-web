"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookText, ChevronLeft } from "lucide-react";
import { usePhoneLayout } from "@/components/use-phone-layout";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";

type Entry = { id?: string | null; code?: string | null; description?: string | null; type?: string | null; amount: number | string };
type Accounting = {
  year: number;
  book: { title: string; code: string } | null;
  revenue: { totalRevenue: number | string; rows: Entry[] };
  books: { cash: Entry[]; inventory: unknown[]; otherTaxes: unknown[] };
  declarations: Array<{ periodKey: string; status: string; vatAmount: number | string; pitAmount: number | string }>;
  bankAccounts: unknown[];
};
type Tab = "revenue" | "books" | "tax";

/** NativeAccountingView on phones: year, Doanh thu | Sổ chi tiết | Kê khai, plain sections. */
export function AccountingMobile() {
  const t = useTranslations("mobile.accounting");
  const tc = useTranslations();
  const phone = usePhoneLayout();
  const [tab, setTab] = useState<Tab>("revenue");
  const [data, setData] = useState<Accounting | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!phone) return;
    const controller = new AbortController();
    fetch("/api/mobile/accounting", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error("load failed");
        setData(json.data as Accounting);
        setError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [phone, attempt]);

  const section = (title: string | null, children: ReactNode) => (
    <section>
      {title && <h3 className="px-4 pb-1 pt-5 text-[17px] text-ios-label-secondary">{title}</h3>}
      <div>{children}</div>
    </section>
  );
  const entryRow = (entry: Entry, negative: boolean, index: number) => (
    <div key={entry.id ?? index} className="flex items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold">{entry.code || "—"}</div>
        {entry.description && <div className="mt-0.5 line-clamp-2 text-[15px] text-ios-label-secondary">{entry.description}</div>}
      </div>
      <div className={cn("shrink-0 text-[17px] font-bold tabular-nums", negative && "text-ios-red")}>{formatCurrency(Number(entry.amount))}</div>
    </div>
  );
  const countRow = (label: string, count: number) => (
    <div key={label} className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 py-3 text-[17px]">
      <span>{label}</span><span className="tabular-nums text-ios-label-secondary">{count}</span>
    </div>
  );
  const empty = (text: string) => <p className="px-4 py-4 text-[15px] text-ios-label-secondary">{text}</p>;

  return (
    <div className="min-h-full bg-surface pb-8 lg:hidden">
      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <Link href={Routes.More} aria-label={tc("common.back")} data-button-radius="pill" className="grid size-11 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)]">
          <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
        </Link>
        <h1 className="truncate text-center text-[17px] font-semibold">{t("title")}</h1>
        <span aria-hidden="true" />
      </div>
      {data && <p className="px-4 pt-4 text-[17px] text-ios-label-secondary">{t("year", { year: data.year })}</p>}
      <div className="mx-4 mt-4 grid grid-cols-3 rounded-full bg-ios-accent/10 p-1">
        {(["revenue", "books", "tax"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} data-button-radius="pill"
            className={cn("min-h-10 rounded-full text-[16px]", tab === key ? "bg-ios-accent font-semibold text-white" : "text-ios-label")}>
            {t(key === "revenue" ? "tabRevenue" : key === "books" ? "tabBooks" : "tabTax")}
          </button>
        ))}
      </div>
      {error && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-[14px] bg-ios-orange/10 px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1 font-semibold">{t("loadError")}</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-ios-accent">{t("retry")}</button>
        </div>
      )}
      {!data ? (!error && <div className="mx-4 mt-6 space-y-3" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-black/[0.06]" />)}</div>)
        : tab === "revenue" ? (
          <>
            {section(t("revenueTitle"), (
              <div className="space-y-3 px-4 py-3">
                <div className="flex items-start gap-3 border-b border-border pb-3">
                  <BookText className="mt-0.5 size-6 shrink-0 text-ios-accent" aria-hidden="true" />
                  <div>
                    <div className="text-[17px] font-semibold">{data.book?.title ?? t("unconfiguredTitle")}</div>
                    <div className="text-[13px] text-ios-label-secondary">{data.book?.code ?? t("unconfiguredSubtitle")}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[13px] text-ios-label-secondary">{t("revenueTotal")}</div>
                  <div className="text-[22px] font-bold tabular-nums">{formatCurrency(Number(data.revenue.totalRevenue))}</div>
                </div>
              </div>
            ))}
            {section(t("entries"), data.revenue.rows.length === 0 ? empty(t("revenueEmpty")) : data.revenue.rows.slice(0, 100).map((entry, i) => entryRow(entry, Number(entry.amount) < 0, i)))}
          </>
        ) : tab === "books" ? (
          <>
            {section(null, [countRow(t("cashCount"), data.books.cash.length), countRow(t("inventoryCount"), data.books.inventory.length), countRow(t("taxesCount"), data.books.otherTaxes.length)])}
            {section(t("recentCash"), data.books.cash.length === 0 ? empty(t("cashEmpty")) : data.books.cash.slice(0, 30).map((entry, i) => entryRow(entry, entry.type === "out", i)))}
          </>
        ) : (
          <>
            {section(null, [countRow(t("declarationsCount"), data.declarations.length), countRow(t("bankAccountsCount"), data.bankAccounts.length)])}
            {section(t("declarations"), data.declarations.length === 0 ? empty(t("taxEmpty")) : data.declarations.map((d) => (
              <div key={d.periodKey} className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold">{d.periodKey}</div><div className="text-[12px] text-ios-label-secondary">{d.status}</div></div>
                <div className="text-[15px] font-bold tabular-nums">{formatCurrency(Number(d.vatAmount) + Number(d.pitAmount))}</div>
              </div>
            )))}
          </>
        )}
    </div>
  );
}
