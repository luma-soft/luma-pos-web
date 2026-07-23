import { getTranslations } from "next-intl/server";
import { Search, Truck } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getSuppliers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { Select } from "@/components/ui/select";
import { SupplierQuickCreate } from "../../suppliers/supplier-form";
import { SuppliersTable } from "./suppliers-table";
import { InstantFilterForm } from "@/components/instant-filter-form";

type SP = Record<string, string | undefined>;
const OWING = ["", "owing", "clear"] as const;
type Owing = (typeof OWING)[number];

export async function SuppliersTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const owing: Owing = OWING.includes(params.owing as Owing) ? (params.owing as Owing) : "";
  const { rows, total, pageCount } = await getSuppliers({ q: params.q, owing: owing === "" ? undefined : owing, page, pageSize });

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="text-sm text-slate-500">{t("suppliers.total", { total })}</span>
        <SupplierQuickCreate />
      </div>

      <InstantFilterForm className="flex items-center gap-3 mb-4" action={Routes.Partners}>
        <input type="hidden" name="tab" value="suppliers" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("suppliers.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <Select
          name="owing"
          defaultValue={owing}
          options={[
            { value: "", label: t("suppliers.filter.allDebt") },
            { value: "owing", label: t("suppliers.filter.owing") },
            { value: "clear", label: t("suppliers.filter.clear") },
          ]}
        />
      </InstantFilterForm>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("suppliers.empty")}</p>
        </div>
      ) : (
        <SuppliersTable rows={rows} />
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("suppliers.unitLabel")} />
    </>
  );
}
