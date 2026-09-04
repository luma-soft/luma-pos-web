import { getTranslations } from "next-intl/server";
import { getSupplier, getSuppliers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { SuppliersTable } from "./suppliers-table";
import { requireStoreContext } from "@/lib/auth/store-context";
import { z } from "zod";

type SP = Record<string, string | undefined>;
const OWING = ["", "owing", "clear"] as const;
type Owing = (typeof OWING)[number];

export async function SuppliersTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const owing: Owing = OWING.includes(params.owing as Owing) ? (params.owing as Owing) : "";
  const detailSupplierId = params.detailSupplierId || null;
  const [{ rows, total, pageCount }, detailSupplier] = await Promise.all([
    getSuppliers(context.storeId, { q: params.q, owing: owing === "" ? undefined : owing, page, pageSize }),
    detailSupplierId && z.uuid().safeParse(detailSupplierId).success ? getSupplier(context.storeId, detailSupplierId) : null,
  ]);

  return (
    <>
      <SuppliersTable
        key={detailSupplierId ?? "suppliers"}
        rows={rows}
        query={params.q ?? ""}
        owing={owing}
        pageSize={pageSize}
        initialDetailId={detailSupplierId}
        initialDetailSupplier={detailSupplier}
      />

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("suppliers.unitLabel")} />
    </>
  );
}
