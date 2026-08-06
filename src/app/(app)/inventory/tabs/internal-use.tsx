import Link from "next/link";
import { FileDown, Plus, Search } from "lucide-react";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { getPurchaseFormOptions } from "@/lib/data/inventory";
import { Routes } from "@/lib/routes";
import { InternalUseTable } from "./internal-use-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";

type SP = Record<string, string | undefined>;

export async function InternalUseTab({ searchParams }: { searchParams: SP }) {
  const [rows, options] = await Promise.all([
    getInternalUseIssues({ limit: 50, q: searchParams.q, status: searchParams.status, warehouseId: searchParams.warehouse, reason: searchParams.reason, department: searchParams.department, from: searchParams.from, to: searchParams.to }),
    getPurchaseFormOptions(),
  ]);

  return (
    <>
      <InstantFilterForm className="mb-4 flex flex-wrap items-center gap-3" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="internal" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Theo mã xuất dùng nội bộ"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm min-h-11 lg:min-h-0"
          />
        </div>
        <InventoryFilterDrawer title="Bộ lọc xuất nội bộ" values={searchParams} fields={["status", "warehouse", "reason", "department", "time"]} warehouses={options.warehouses.map((item) => ({ value: item.id, label: item.name }))} reasons={[{ value: "materials", label: "Vật tư" }, { value: "damaged", label: "Hư hỏng" }, { value: "internal", label: "Sử dụng nội bộ" }]} />
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
