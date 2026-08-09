import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Warehouse } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatNumber } from "@/lib/utils";
import {
  getInventory,
  getInventoryOverview,
  getPurchaseFormOptions,
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
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { ListSearchFilterBar, ListSearchInput } from "@/components/list-search-filter";

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
      {status ? (
        <StockStatusDetail searchParams={searchParams} status={status} />
      ) : (
        <StockOverviewContent />
      )}
    </Suspense>
  );
}

async function StockOverviewContent() {
  const [overview, movements] = await Promise.all([
    getInventoryOverview(),
    getRecentMovements(100),
  ]);
  const movementItems = movements.map((movement) => ({
    ...movement,
    quantity: Number(movement.quantity),
    createdAt: serializeMovementCreatedAt(movement.createdAt),
  }));

  return (
    <StockOverview
      totalValue={overview.totalValue}
      totalSkuCount={overview.totalSkuCount}
      movementCount={movements.length}
      statusCounts={overview.statusCounts}
      movements={movementItems}
    />
  );
}

async function StockStatusDetail({
  searchParams,
  status,
}: {
  searchParams: SP;
  status: InventoryStockStatus;
}) {
  const t = await getTranslations();
  const page = Number(searchParams.page) || 1;
  const pageSize = parsePageSize(searchParams.size);
  const category = searchParams.category ?? "";
  const warehouse = searchParams.warehouse ?? "";
  const [{ rows, total, pageCount }, productOptions, purchaseOptions] =
    await Promise.all([
      getInventory({
        q: searchParams.q,
        stock: status,
        categoryId: category || undefined,
        warehouseId: warehouse || undefined,
        page,
        pageSize,
      }),
      getProductFormOptions(),
      getPurchaseFormOptions(),
    ]);

  return (
    <div className="space-y-5" data-layout="inventory-stock-status-detail">
      <header>
        <Link
          href={`${Routes.Inventory}?tab=stock`}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("inventory.backToWarehouse")}
        </Link>
        <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-slate-950 dark:text-white">
          {t(`inventory.statusCards.${status}.label`)}
        </h2>
        <div className="mt-1 text-sm font-medium text-slate-500">
          {t("inventory.skuTotal", { count: formatNumber(total) })}
        </div>
        <p className="mt-5 text-sm text-slate-500">
          {t(`inventory.statusCards.${status}.description`)}
        </p>
      </header>

      <ListSearchFilterBar
        search={(
          <InstantFilterForm action={Routes.Inventory}>
            <input type="hidden" name="tab" value="stock" />
            <input type="hidden" name="stockStatus" value={status} />
            <ListSearchInput name="q" defaultValue={searchParams.q ?? ""} placeholder={t("inventory.searchPlaceholder")} />
          </InstantFilterForm>
        )}
        filter={<InventoryFilterDrawer title="Bộ lọc kho hàng" values={searchParams} fields={["warehouse", "category", "stock"]} warehouses={purchaseOptions.warehouses.map((item) => ({ value: item.id, label: item.name }))} categories={productOptions.categories.map((item) => ({ value: item.id, label: item.name }))} />}
      />

      <section aria-labelledby="inventory-product-list-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3
            id="inventory-product-list-heading"
            className="text-base font-bold text-slate-900 dark:text-slate-100"
          >
            {t("inventory.productList")}
          </h3>
          <span className="text-sm font-medium text-slate-500">
            {t("inventory.skuTotal", { count: formatNumber(total) })}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-card border border-border bg-surface p-12 text-center text-slate-400 shadow-e1">
            <Warehouse className="mx-auto mb-3 h-10 w-10 opacity-60" />
            <p className="font-medium">{t("inventory.empty")}</p>
          </div>
        ) : (
          <StockTable rows={rows} stock={status} />
        )}
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          unitLabel={t("products.unitLabel")}
        />
      </section>
    </div>
  );
}
