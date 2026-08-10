import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PackageX, Plus } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getPurchaseReturnFormOptions, getPurchaseReturns } from "@/lib/data/purchase-returns";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { PurchaseReturnsTable } from "./purchase-returns-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { PurchaseReturnsFilter } from "./purchase-returns-filter";
import { ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { requireStoreContext } from "@/lib/auth/store-context";

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
  const context = await requireStoreContext();
  const t = await getTranslations();
  const page = Number(searchParams.page) || 1;
  const pageSize = parsePageSize(searchParams.size);
  const [{ rows, total, pageCount }, options] = await Promise.all([
    getPurchaseReturns(context.storeId, { q: searchParams.q, status: searchParams.status, settlement: searchParams.settlement, supplierId: searchParams.supplierId, warehouseId: searchParams.warehouseId, from: searchParams.from, to: searchParams.to, page, pageSize }),
    getPurchaseReturnFormOptions(context.storeId),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InstantFilterForm className="flex min-w-0 flex-1 flex-wrap items-center gap-3" action={Routes.Inventory}>
          <input type="hidden" name="tab" value="purchase-returns" />
          <ListSearchFilterBar
            search={<ListSearchInput name="q" defaultValue={searchParams.q ?? ""} placeholder={t("purchaseReturns.searchPlaceholder")} />}
            filter={<PurchaseReturnsFilter suppliers={options.suppliers} warehouses={options.warehouses} values={searchParams} resultCount={total} />}
          />
          <Link href={Routes.PurchaseReturnNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary-600 text-primary-600 bg-surface hover:bg-primary-50 text-sm font-semibold transition active:scale-[0.98] ml-auto shrink-0 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
            <Plus className="w-4 h-4" />
            {t("purchaseReturns.createNew")}
          </Link>
        </InstantFilterForm>
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
