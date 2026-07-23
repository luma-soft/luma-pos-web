import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Truck, Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getPurchases } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { Select } from "@/components/ui/select";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { PurchasesTable } from "./purchases-table";

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
  const { rows, total, pageCount } = await getPurchases({ q: params.q, status: status || undefined, page, pageSize });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InstantFilterForm className="flex min-w-0 flex-1 flex-wrap items-center gap-3" action={Routes.Inventory}>
          <input type="hidden" name="tab" value="purchases" />
          <div className="relative min-w-[240px] flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("purchases.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
          </div>
          <Select name="status" defaultValue={status} options={[{ value: "", label: t("orders.tabs.all") }, { value: "draft", label: t("purchases.status.draft") }, { value: "received", label: t("purchases.status.received") }, { value: "returned", label: t("purchases.status.returned") }, { value: "cancelled", label: t("purchases.status.cancelled") }]} />
          <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98] ml-auto shrink-0"><Plus className="w-4 h-4" />{t("purchases.createNew")}</Link>
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
          <PurchasesTable rows={rows} />
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("purchases.unitLabel")} />
    </>
  );
}
