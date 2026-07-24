import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, stockLevels, warehouses } from "@/db/schema";
import { StocktakeForm } from "./stocktake-form";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";

export const dynamic = "force-dynamic";

export default async function NewStocktakePage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const { wh } = await searchParams;
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault));

  const defaultWh = warehouseRows.find((w) => w.id === wh)?.id ?? warehouseRows[0]?.id;

  const productRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      // tồn theo từng kho — load kho mặc định, client đổi kho sẽ refetch qua URL
      stock: sql<string>`coalesce((
        select ${stockLevels.quantity} from ${stockLevels}
        where ${stockLevels.productId} = ${products.id}
          and ${stockLevels.warehouseId} = ${defaultWh ?? sql`null`}
      ), 0)`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.isActive, true), stockManagedCategoryCondition()))
    .orderBy(asc(products.name))
    .limit(500);

  return (
    <StocktakeForm
      activeWarehouseId={defaultWh ?? ""}
      warehouses={warehouseRows}
      products={productRows.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, baseUnit: p.baseUnit,
        costPrice: Number(p.costPrice), stock: Number(p.stock),
      }))}
    />
  );
}
