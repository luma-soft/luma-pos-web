import { getTranslations } from "next-intl/server";
import { getSupplier, getSuppliers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { DesktopPagination } from "@/components/mobile-load-more";
import { loadSuppliersPage } from "./load-more-actions";
import { parsePageSize } from "@/lib/pagination";
import { SuppliersTable } from "./suppliers-table";
import { requireStoreContext } from "@/lib/auth/store-context";
import { z } from "zod";

type SP = Record<string, string | undefined>;
const OWING = ["", "owing", "clear"] as const;
type Owing = (typeof OWING)[number];

/** List filters shared by the server page and the phone load-more action. */
export function suppliersListFilters(params: SP) {
  const owing: Owing = OWING.includes(params.owing as Owing) ? (params.owing as Owing) : "";
  return { q: params.q, owing: owing === "" ? undefined : owing };
}

export async function SuppliersTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const owing: Owing = OWING.includes(params.owing as Owing) ? (params.owing as Owing) : "";
  const detailSupplierId = params.detailSupplierId || null;
  const [{ rows, total, totalDebt, totalPurchase, pageCount }, detailSupplier] = await Promise.all([
    getSuppliers(context.storeId, { q: params.q, owing: owing === "" ? undefined : owing, page, pageSize }),
    detailSupplierId && z.uuid().safeParse(detailSupplierId).success ? getSupplier(context.storeId, detailSupplierId) : null,
  ]);

  return (
    <>
      <SuppliersTable
        rows={rows}
        totalDebt={totalDebt}
        totalPurchase={totalPurchase}
        query={params.q ?? ""}
        owing={owing}
        pageSize={pageSize}
        initialDetailId={detailSupplierId}
        initialDetailSupplier={detailSupplier}
        loadMore={{ page, pageCount, loadPage: loadSuppliersPage.bind(null, params) }}
      />

      <DesktopPagination>
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("suppliers.unitLabel")} />
      </DesktopPagination>
    </>
  );
}
