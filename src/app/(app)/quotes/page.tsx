import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, count, desc, eq, or } from "drizzle-orm";
import { FileSpreadsheet, ShoppingCart, Search } from "lucide-react";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { accentInsensitiveLike } from "@/lib/search";
import { formatCurrency, formatDate } from "@/lib/utils";
import { QuoteActions } from "./quote-actions";

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function QuotesPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const q = params.q?.trim();

  const where = q
    ? and(eq(orders.status, "quote"), or(accentInsensitiveLike(orders.code, q), accentInsensitiveLike(customers.name, q), accentInsensitiveLike(orders.projectName, q)))
    : and(eq(orders.status, "quote"));
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: orders.id,
        code: orders.code,
        total: orders.total,
        projectName: orders.projectName,
        createdAt: orders.createdAt,
        customerName: customers.name,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(20)
      .offset((page - 1) * 20),
    db.select({ total: count() }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),
  ]);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("quotes.title")}</h1>
          <span className="text-sm text-slate-500">{t("quotes.total", { total })}</span>
        </div>
        <Link href={Routes.POS} target="_blank" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
          <ShoppingCart className="w-4 h-4" />
          {t("quotes.createViaPos")}
        </Link>
      </div>

      <form className="flex items-center gap-3 mb-4" action={Routes.Quotes}>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white">{t("common.search")}</button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("quotes.empty")}</p>
          <p className="text-sm mt-1">{t("quotes.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((q) => (
            <div key={q.id} className="bg-surface border border-border rounded-card p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={Routes.order(q.id)} className="min-w-0">
                  <div className="font-semibold text-primary-600">{q.code}</div>
                  <div className="text-xs text-slate-400">{formatDate(q.createdAt)} · {q.customerName ?? t("orders.walkIn")}</div>
                </Link>
                <span className="shrink-0 font-semibold tabular-nums text-sm">{formatCurrency(Number(q.total))}</span>
              </div>
              <div className="mt-2 flex justify-end"><QuoteActions quoteId={q.id} /></div>
            </div>
          ))}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("quotes.cols.code")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.date")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.customer")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.project")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("quotes.cols.value")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((q) => (
                <tr key={q.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={Routes.order(q.id)} className="font-medium text-primary-600 hover:underline">{q.code}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(q.createdAt)}</td>
                  <td className="px-4 py-3">{q.customerName ?? t("orders.walkIn")}</td>
                  <td className="px-4 py-3 text-slate-500">{q.projectName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(q.total))}</td>
                  <td className="px-4 py-3 text-right">
                    <QuoteActions quoteId={q.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
