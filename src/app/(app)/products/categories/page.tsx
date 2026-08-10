import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { getCategoriesWithCounts } from "@/lib/data/categories";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { CategoriesManager } from "./categories-manager";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const context = await requireStoreContext();
  const [t, categoryData] = await Promise.all([getTranslations(), getCategoriesWithCounts(context.storeId, { page, pageSize })]);
  return (
    <div className="w-full min-w-0 p-4 sm:p-6">
      <MobileDetailHeader backHref={Routes.Products} backLabel={t("common.back")} title={t("categories.title")} />
      <CategoriesManager categories={categoryData.rows} parentOptions={categoryData.roots} total={categoryData.total} />
      <Pagination page={page} pageCount={categoryData.pageCount} total={categoryData.total} pageSize={pageSize} unitLabel={t("categories.unitLabel")} />
    </div>
  );
}
