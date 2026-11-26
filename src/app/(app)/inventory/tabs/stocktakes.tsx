import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ClipboardCheck, Plus } from "lucide-react";
import { ListSearchInput } from "@/components/list-search-filter";
import { getStocktakeListPage } from "@/lib/data/stocktakes";
import { Routes } from "@/lib/routes";
import { StocktakesTable } from "./stocktakes-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { DesktopPagination } from "@/components/mobile-load-more";
import { loadStocktakesPage } from "./load-more-actions";

type SP = Record<string, string | undefined>;


export async function StocktakesTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const pageSize = parsePageSize(searchParams.size);
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.page) || 1));
  const { rows, total, page, pageCount, canViewValues } = await getStocktakeListPage(context, searchParams, requestedPage, pageSize);

  return (
    <section className="space-y-4" aria-labelledby="stocktake-list-heading">
      <h2 id="stocktake-list-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">
        {t("stocktakes.listTitle")}
      </h2>
      <InstantFilterForm
        className="flex flex-wrap items-center gap-3"
        action={Routes.Inventory}
      >
        <input type="hidden" name="tab" value="stock" />
        <div className="relative w-full max-w-sm max-lg:max-w-none">
          <ListSearchInput name="stocktakeQ" defaultValue={searchParams.stocktakeQ ?? ""} placeholder="Theo mã phiếu kiểm" />
        </div>
        <Link href={Routes.StocktakeNew} className="ml-auto max-lg:hidden inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          <Plus className="h-4 w-4" />
          {t("stocktakes.createNew")}
        </Link>
      </InstantFilterForm>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400 max-lg:border-0 max-lg:py-24 max-lg:text-ios-label-secondary">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("stocktakes.empty")}</p>
          <p className="text-sm mt-1">{t("stocktakes.emptyHint")}</p>
        </div>
      ) : (
        <StocktakesTable
          rows={rows}
          fillHeight={false}
          canCancelBalanced={canViewValues}
          canViewValues={canViewValues}
          loadMore={{ page, pageCount, loadPage: loadStocktakesPage.bind(null, searchParams) }}
        />
      )}
      <DesktopPagination>
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          unitLabel={t("stocktakes.unitLabel")}
        />
      </DesktopPagination>
      <p className="text-xs text-slate-400 max-lg:hidden">{t("stocktakes.balanceHint")}</p>
    </section>
  );
}
