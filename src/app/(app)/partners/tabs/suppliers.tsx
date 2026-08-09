import { getTranslations } from "next-intl/server";
import { getSuppliers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { SuppliersTable } from "./suppliers-table";

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
      <SuppliersTable
        rows={rows}
        total={total}
        query={params.q ?? ""}
        owing={owing}
        pageSize={pageSize}
      />

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("suppliers.unitLabel")} />
    </>
  );
}
