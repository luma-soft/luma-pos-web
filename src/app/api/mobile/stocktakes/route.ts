import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { createStocktake } from "@/lib/actions/stocktakes";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { stocktakeListSummaryFields } from "@/lib/stocktakes/list-summary-fields";
import {
  requireMobileStockAccess,
  requireMobileStockReadAccess,
} from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const url = new URL(request.url);
  const hasPagination = url.searchParams.has("page") || url.searchParams.has("pageSize") || url.searchParams.has("q");
  if (hasPagination) {
    const query = searchParam(request, "q");
    const page = Math.max(1, Math.floor(numberParam(request, "page", 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(numberParam(request, "pageSize", 30))));
    const where = and(
      eq(stocktakes.storeId, gate.storeId),
      ne(stocktakes.status, "cancelled"),
      query ? or(
        ilike(stocktakes.code, `%${query}%`),
        ilike(stocktakes.note, `%${query}%`),
        ilike(warehouses.name, `%${query}%`),
        ilike(profiles.fullName, `%${query}%`),
      ) : undefined,
    );
    const [countResult] = await db
      .select({ total: count() })
      .from(stocktakes)
      .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
      .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
      .where(where);
    const total = countResult?.total ?? 0;
    const rows = await db
      .select({
        id: stocktakes.id,
        code: stocktakes.code,
        status: stocktakes.status,
        note: stocktakes.note,
        createdAt: stocktakes.createdAt,
        balancedAt: stocktakes.balancedAt,
        warehouseName: warehouses.name,
        byName: profiles.fullName,
        itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
        totalDiff: sql<string>`coalesce((select sum(${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id}), 0)`,
        ...stocktakeListSummaryFields(gate.storeId, canViewPurchasePrices(gate.role)),
      })
      .from(stocktakes)
      .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
      .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
      .where(where)
      .orderBy(desc(stocktakes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return mobileOk({ rows, total, page, pageSize });
  }

  const rows = await db
    .select({
      id: stocktakes.id,
      code: stocktakes.code,
      status: stocktakes.status,
      note: stocktakes.note,
      createdAt: stocktakes.createdAt,
      balancedAt: stocktakes.balancedAt,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
      itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
      totalDiff: sql<string>`coalesce((select sum(${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id}), 0)`,
      ...stocktakeListSummaryFields(gate.storeId, canViewPurchasePrices(gate.role)),
    })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .where(and(eq(stocktakes.storeId, gate.storeId), ne(stocktakes.status, "cancelled")))
    .orderBy(desc(stocktakes.createdAt))
    .limit(50);

  return mobileOk(rows);
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });
  if (
    typeof body === "object" &&
    "balanceNow" in body &&
    body.balanceNow === true
  ) {
    return mobileError("stocktakes.errors.createDraftFirst", 409);
  }

  return mobileAction(
    await createStocktake({
      ...(body as Parameters<typeof createStocktake>[0]),
      balanceNow: false,
    }),
  );
}
