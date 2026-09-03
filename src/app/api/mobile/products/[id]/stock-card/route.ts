import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, stockLevels, warehouses } from "@/db/schema";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, mobileError, numberParam } from "@/lib/mobile/response";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  const [product] = await db.select({ id: products.id, isVariantParent: products.isVariantParent }).from(products)
    .where(and(eq(products.storeId, gate.storeId), eq(products.id, id))).limit(1);
  if (!product) return mobileError("errors.notFound", 404);
  if (product.isVariantParent) return mobileError("products.variants.selectSku");
  const page = Math.max(1, Math.floor(numberParam(request, "page", 1)));
  const pageSize = Math.max(1, Math.min(100, Math.floor(new URL(request.url).searchParams.has("pageSize") ? numberParam(request, "pageSize", 30) : 30)));
  const locations = await db.select({ warehouseId: stockLevels.warehouseId, warehouseName: warehouses.name,
    quantity: stockLevels.quantity, reserved: stockLevels.reserved }).from(stockLevels)
    .innerJoin(warehouses, and(eq(warehouses.storeId, gate.storeId), eq(warehouses.id, stockLevels.warehouseId)))
    .where(and(eq(stockLevels.storeId, gate.storeId), eq(stockLevels.productId, id)));
  const currentStock = locations.reduce((sum, location) => sum + Number(location.quantity), 0);
  const movements = await db.execute(sql`
    select m.id, m.created_at as "createdAt", m.type, m.quantity, m.unit_cost as "unitCost", m.ref_type as "refType",
      m.ref_id as "refId", m.note, w.name as "warehouseName",
      (${currentStock}::numeric - coalesce(sum(m.quantity) over(order by m.created_at desc,m.id desc rows between unbounded preceding and 1 preceding),0))::text as "stockAfter"
    from stock_movements m left join warehouses w on w.store_id=m.store_id and w.id=m.warehouse_id
    where m.store_id=${gate.storeId}::uuid and m.product_id=${id}::uuid
    order by m.created_at desc,m.id desc limit ${pageSize + 1} offset ${(page - 1) * pageSize}
  `);
  return mobileOk({ movements: movements.rows.slice(0, pageSize), stockLocations: locations, page, pageSize, hasMore: movements.rows.length > pageSize });
}
