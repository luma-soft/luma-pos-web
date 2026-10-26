import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { requireStockAccess } from "@/lib/actions/common";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const gate = await requireStockAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
  }

  const [stocktake] = await db
    .select({
      id: stocktakes.id,
      code: stocktakes.code,
      status: stocktakes.status,
      note: stocktakes.note,
      createdAt: stocktakes.createdAt,
      balancedAt: stocktakes.balancedAt,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
    })
    .from(stocktakes)
    .innerJoin(warehouses, and(
      eq(stocktakes.warehouseId, warehouses.id),
      eq(warehouses.storeId, gate.storeId),
    ))
    .leftJoin(profiles, and(
      eq(stocktakes.createdBy, profiles.id),
      eq(profiles.storeId, gate.storeId),
    ))
    .where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id)))
    .limit(1);

  if (!stocktake) {
    return NextResponse.json({ ok: false, error: "errors.notFound" }, { status: 404 });
  }

  const items = await db
    .select({
      id: stocktakeItems.id,
      productName: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      systemQty: stocktakeItems.systemQty,
      actualQty: stocktakeItems.actualQty,
    })
    .from(stocktakeItems)
    .innerJoin(products, and(
      eq(stocktakeItems.productId, products.id),
      eq(products.storeId, gate.storeId),
    ))
    .where(and(
      eq(stocktakeItems.storeId, gate.storeId),
      eq(stocktakeItems.stocktakeId, id),
    ))
    .orderBy(asc(products.name), asc(products.sku));

  return NextResponse.json(
    { ok: true, data: { ...stocktake, items } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
