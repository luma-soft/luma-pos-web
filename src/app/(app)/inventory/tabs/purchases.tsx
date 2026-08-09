import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Truck } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getPurchaseFormOptions, getPurchases } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { PurchasesTable } from "./purchases-table";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";

type SP = Record<string, string | undefined>;
const PSTATUS = ["", "draft", "received", "returned", "cancelled"] as const;

export async function PurchasesTab({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <PurchasesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PurchasesContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status = PSTATUS.includes(params.status as typeof PSTATUS[number]) ? (params.status ?? "") : "";
  const [{ rows, total, pageCount }, printTemplates, options] = await Promise.all([
    getPurchases({ q: params.q, status: status || undefined, supplierId: params.supplierId, warehouseId: params.warehouseId, from: params.from, to: params.to, debtOnly: params.debtOnly === "1", page, pageSize }),
    getPrintTemplatesForDoc("purchase"),
    getPurchaseFormOptions(),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InstantFilterForm className="flex min-w-0 flex-1 flex-wrap items-center gap-3" action={Routes.Inventory}>
          <input type="hidden" name="tab" value="purchases" />
          <ListSearchFilterBar
            search={<ListSearchInput name="q" defaultValue={params.q ?? ""} placeholder={t("purchases.searchPlaceholder")} />}
            filter={<InventoryFilterDrawer title="Bộ lọc phiếu nhập" values={params} resultCount={total} resultLabel="phiếu nhập" countEndpoint="/api/inventory/purchases/count" fields={["status", "supplier", "warehouse", "time", "debt"]} suppliers={options.suppliers.map((item) => ({ value: item.id, label: item.name }))} warehouses={options.warehouses.map((item) => ({ value: item.id, label: item.name }))} />}
          />
          <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98] ml-auto shrink-0 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"><Plus className="w-4 h-4" />{t("purchases.createNew")}</Link>
        </InstantFilterForm>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("purchases.empty")}</p>
          <p className="text-sm mt-1">{t("purchases.emptyHint")}</p>
        </div>
      ) : (
        <>
          <PurchasesTable rows={rows} printTemplates={printTemplates} />
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("purchases.unitLabel")} />
    </>
  );
}
