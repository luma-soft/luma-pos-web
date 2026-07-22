import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PackageX, Plus, Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getPurchaseReturns } from "@/lib/data/purchase-returns";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { PurchaseReturnsTable } from "./purchase-returns-table";

type SP = Record<string, string | undefined>;

export async function PurchaseReturnsTab({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <PurchaseReturnsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PurchaseReturnsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const page = Number(searchParams.page) || 1;
  const pageSize = parsePageSize(searchParams.size);
  const { rows, total, pageCount } = await getPurchaseReturns({ q: searchParams.q, page, pageSize });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-3" action={Routes.Inventory}>
          <input type="hidden" name="tab" value="purchase-returns" />
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" name="q" defaultValue={searchParams.q ?? ""} placeholder={t("purchaseReturns.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
          </div>
          <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white">{t("common.search")}</button>
          <Link href={Routes.PurchaseReturnNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary-600 text-primary-600 bg-surface hover:bg-primary-50 text-sm font-semibold transition active:scale-[0.98] ml-auto shrink-0">
            <Plus className="w-4 h-4" />
            {t("purchaseReturns.createNew")}
          </Link>
        </form>
        <span className="shrink-0 text-sm text-slate-500">{t("purchaseReturns.total", { total })}</span>
      </div>
      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <PackageX className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("purchaseReturns.empty")}</p>
          <p className="text-sm mt-1">{t("purchaseReturns.emptyHint")}</p>
        </div>
      ) : (
        <PurchaseReturnsTable rows={rows} />
      )}
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("purchaseReturns.unitLabel")} />
    </>
  );
}
