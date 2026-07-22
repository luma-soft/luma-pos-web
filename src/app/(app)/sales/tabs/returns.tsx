import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileX2, Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getReturn, getReturns } from "@/lib/data/returns";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { ReturnDetailPanel } from "./return-detail-panel";
import { ReturnsTable } from "./returns-table";

type SP = Record<string, string | undefined>;

export async function ReturnsTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;

  return (
    <>
      <form className="mb-4 flex flex-wrap items-center gap-2" action={Routes.Sales}>
        <input type="hidden" name="tab" value="returns" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={t("returns.searchPlaceholder")}
            aria-label={t("common.search")}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button type="submit" className="rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          {t("common.search")}
        </button>
        <Link href={`${Routes.POS}?draft=return_quick`} className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          {t("returns.create")}
        </Link>
        {params.q && (
          <Link href={`${Routes.Sales}?tab=returns`} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {t("common.clear")}
          </Link>
        )}
      </form>

      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <ReturnsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReturnsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const page = Number(searchParams.page) || 1;
  const pageSize = parsePageSize(searchParams.size);
  const expandedId = searchParams.expandedReturn ?? null;
  const [{ rows, total, pageCount }, expandedReturn] = await Promise.all([
    getReturns({ q: searchParams.q, page, pageSize }),
    expandedId ? getReturn(expandedId).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      <div className="mb-2">
        <span className="text-sm text-slate-500">{t("returns.total", { total })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
          <FileX2 className="mx-auto mb-3 h-10 w-10 opacity-60" />
          <p className="font-medium">{t("returns.empty")}</p>
          <p className="mt-1 text-sm">{t("returns.emptyHint")}</p>
        </div>
      ) : (
        <ReturnsTable
          rows={rows}
          expandedId={expandedReturn?.id ?? expandedId}
          expandedContent={expandedReturn ? <ReturnDetailPanel ret={expandedReturn} compact /> : null}
        />
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("returns.title")} />
    </>
  );
}
