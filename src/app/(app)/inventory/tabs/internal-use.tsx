import Link from "next/link";
import { FileDown, Plus } from "lucide-react";
import { getInternalUseIssueCount, getInternalUseIssues } from "@/lib/data/internal-use";
import { getPurchaseFormOptions } from "@/lib/data/inventory";
import { Routes } from "@/lib/routes";
import { InternalUseTable } from "./internal-use-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { getTranslations } from "next-intl/server";
import { ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";

type SP = Record<string, string | undefined>;

export async function InternalUseTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const filters = {
    q: searchParams.q,
    status: searchParams.status,
    warehouseId: searchParams.warehouse,
    reason: searchParams.reason,
    department: searchParams.department,
    from: searchParams.from,
    to: searchParams.to,
  };
  const [rows, options, total] = await Promise.all([
    getInternalUseIssues({ limit: 50, ...filters }),
    getPurchaseFormOptions(),
    getInternalUseIssueCount(filters),
  ]);
  const departments = Array.from(
    new Set(rows.map((row) => row.department?.trim()).filter(Boolean)),
  ).map((value) => ({ value: value!, label: value! }));

  return (
    <>
      <InstantFilterForm className="mb-4 flex flex-wrap items-center gap-3" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="internal" />
        <ListSearchFilterBar
          search={<ListSearchInput name="q" defaultValue={searchParams.q ?? ""} placeholder="Theo mã xuất dùng nội bộ" />}
          filter={<InventoryFilterDrawer title={t("internalUse.filterTitle")} values={searchParams} fields={["status", "warehouse", "reason", "department", "time"]} resultCount={total} resultLabel={t("internalUse.filterUnit")} countEndpoint="/api/inventory/internal-use/count" warehouses={options.warehouses.map((item) => ({ value: item.id, label: item.name }))} reasons={[{ value: "materials", label: "Vật tư" }, { value: "damaged", label: "Hư hỏng" }, { value: "internal", label: "Sử dụng nội bộ" }]} departments={departments} />}
        />
        <Link href={Routes.InternalUseNew} className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
          <Plus className="h-4 w-4" />
          Xuất nội bộ
        </Link>
        <button type="button" className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-surface-2 active:scale-[0.98] dark:text-slate-200 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
          <FileDown className="h-4 w-4" />
          Xuất file
        </button>
      </InstantFilterForm>

      <InternalUseTable rows={rows} />
    </>
  );
}
