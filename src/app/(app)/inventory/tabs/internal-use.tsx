import Link from "next/link";
import { FileDown, Plus, Search } from "lucide-react";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { Routes } from "@/lib/routes";
import { InternalUseTable } from "./internal-use-table";
import { InstantFilterForm } from "@/components/instant-filter-form";

type SP = Record<string, string | undefined>;

export async function InternalUseTab({ searchParams }: { searchParams: SP }) {
  const rows = await getInternalUseIssues({ limit: 50, q: searchParams.q });

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
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <Link href={Routes.InternalUseNew} className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          <Plus className="h-4 w-4" />
          Xuất nội bộ
        </Link>
        <button type="button" className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-surface-2 active:scale-[0.98] dark:text-slate-200">
          <FileDown className="h-4 w-4" />
          Xuất file
        </button>
      </InstantFilterForm>

      <InternalUseTable rows={rows} />
    </>
  );
}
