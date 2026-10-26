import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Warehouse } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatNumber } from "@/lib/utils";
import {
  getInventory,
  getInventoryOverview,
  getRecentMovements,
  type InventoryStatusCounts,
} from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { getProductFormOptions } from "@/lib/data/products";
import { TableSkeleton } from "@/components/table-skeleton";
import { StockTable } from "./stock-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { serializeMovementCreatedAt } from "@/lib/inventory/movement-serialization";
import { StockOverview } from "./stock-overview";
import { StocktakesTab } from "./stocktakes";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";
import { requireStoreContext } from "@/lib/auth/store-context";
import { InventoryDrawer } from "./inventory-drawer";

type SP = Record<string, string | undefined>;
type InventoryStockStatus = keyof InventoryStatusCounts;

const STOCK_STATUSES: InventoryStockStatus[] = [
  "negativeStock",
  "outOfStock",
  "lowStock",
  "inStock",
];

function parseStockStatus(value: string | undefined) {
  return STOCK_STATUSES.includes(value as InventoryStockStatus)
    ? (value as InventoryStockStatus)
    : undefined;
}

export async function StockTab({ searchParams }: { searchParams: SP }) {
  const status = parseStockStatus(searchParams.stockStatus);

  return (
    <Suspense fallback={<TableSkeleton cols={6} rows={8} />}>
      <>
        <StockOverviewContent searchParams={status ? { tab: "stock" } : searchParams} />
        {status && <StockStatusDetail searchParams={searchParams} status={status} />}
      </>
    </Suspense>
  );
}

async function StockOverviewContent({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const [overview, movements] = await Promise.all([
    getInventoryOverview(context.storeId),
    getRecentMovements(context.storeId, 100),
  ]);
  const movementItems = movements.map((movement) => ({
    ...movement,
    quantity: Number(movement.quantity),
    createdAt: serializeMovementCreatedAt(movement.createdAt),
  }));

  return (
    <StockOverview
      totalValue={overview.totalValue}
      productCount={overview.totalSkuCount}
      statusCounts={overview.statusCounts}
      movements={movementItems}
    >
      <StocktakesTab searchParams={searchParams} />
    </StockOverview>
  );
}

async function StockStatusDetail({
  searchParams,
  status,
}: {
  searchParams: SP;
  status: InventoryStockStatus;
}) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const page = Number(searchParams.page) || 1;
  const pageSize = parsePageSize(searchParams.size);
  const category = searchParams.category ?? "";
  const [{ rows, total, pageCount }, productOptions] =
    await Promise.all([
      getInventory(context.storeId, {
        q: searchParams.q,
        stock: status,
        categoryId: category || undefined,
        page,
        pageSize,
      }),
      getProductFormOptions(context.storeId),
    ]);
  const title = t(`inventory.statusCards.${status}.label`);
  const subtitle = `${t("inventory.skuTotal", { count: formatNumber(total) })} · ${t(`inventory.statusCards.${status}.description`)}`;

  return (
    <InventoryDrawer
      title={title}
      subtitle={subtitle}
      ariaLabel={title}
      icon={<Warehouse className="h-5 w-5" />}
      closeLabel={t("common.close")}
      closeHref={`${Routes.Inventory}?tab=stock`}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      footer={(
        <div className="[&>div]:mt-0">
          <Pagination
            page={page}
            pageCount={pageCount}
            total={total}
            pageSize={pageSize}
            unitLabel={t("products.unitLabel")}
          />
        </div>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col" data-layout="inventory-stock-status-detail">
        <div className="shrink-0 border-b border-border bg-canvas/60 p-4">
          <ListSearchFilterBar
            className="w-full"
            searchClassName="min-w-0 flex-1"
            search={(
              <InstantFilterForm action={Routes.Inventory}>
                <input type="hidden" name="tab" value="stock" />
                <input type="hidden" name="stockStatus" value={status} />
                <ListSearchInput name="q" defaultValue={searchParams.q ?? ""} placeholder={t("inventory.searchPlaceholder")} />
              </InstantFilterForm>
            )}
            filter={<InventoryFilterDrawer title="Bộ lọc kho hàng" values={searchParams} fields={["category", "stock"]} categories={productOptions.categories.map((item) => ({ value: item.id, label: item.name }))} />}
          />
        </div>

        <section className="min-h-0 flex-1 overflow-auto p-4" aria-label={t("inventory.productList")}>
          {rows.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-12 text-center text-slate-400 shadow-e1">
              <Warehouse className="mx-auto mb-3 h-10 w-10 opacity-60" />
              <p className="font-medium">{t("inventory.empty")}</p>
            </div>
          ) : (
            <StockTable rows={rows} stock={status} />
          )}
        </section>
      </div>
    </InventoryDrawer>
  );
}
