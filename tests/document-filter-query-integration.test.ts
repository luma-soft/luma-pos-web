import { afterAll, describe, expect, mock, test } from "bun:test";
import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { orderItems, orders } from "../src/db/schema";

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const db = pool ? drizzle(pool) : null;

if (db) mock.module("@/db", () => ({ db }));
const getOrders = db
  ? (await import("../src/lib/data/orders")).getOrders
  : null;

afterAll(async () => {
  await pool?.end();
  mock.restore();
});

integrationDescribe("document filter database integration", () => {
  test("combines search, exact customer, exact product and document scope", async () => {
    const [fixture] = await db!
      .select({
        id: orders.id,
        storeId: orders.storeId,
        code: orders.code,
        customerId: orders.customerId,
        productId: orderItems.productId,
      })
      .from(orders)
      .innerJoin(orderItems, and(
        eq(orderItems.orderId, orders.id),
        eq(orderItems.storeId, orders.storeId),
      ))
      .where(and(
        eq(orders.documentType, "sale"),
        isNotNull(orders.customerId),
        isNotNull(orderItems.productId),
      ))
      .limit(1);

    expect(fixture).toBeDefined();
    if (!fixture?.customerId || !fixture.productId) return;
    const result = await getOrders!(fixture.storeId, {
      documentType: "sale",
      q: fixture.code,
      customerId: fixture.customerId,
      productId: fixture.productId,
      includeCancelled: true,
      page: 1,
      pageSize: 20,
    });
    expect(result.rows.some((row) => row.id === fixture.id)).toBe(true);
    expect(result.rows.every((row) => row.documentType === "sale")).toBe(true);
  });

  test("uses identical conditions for count preview and paginated list", async () => {
    const [fixture] = await db!.select({ storeId: orders.storeId }).from(orders).limit(1);
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const filters = {
      documentType: "sale" as const,
      status: "all" as const,
      includeCancelled: true,
      from: "2026-07-01",
      to: "2026-08-06",
      minTotal: 0,
      maxTotal: 10_000_000,
    };
    const [preview, list] = await Promise.all([
      getOrders!(fixture.storeId, { ...filters, page: 1, pageSize: 1 }),
      getOrders!(fixture.storeId, { ...filters, page: 1, pageSize: 30 }),
    ]);
    expect(preview.total).toBe(list.total);
    expect(preview.pageCount).toBe(Math.max(1, Math.ceil(preview.total / 1)));
    expect(list.pageCount).toBe(Math.max(1, Math.ceil(list.total / 30)));
  });

  test("never leaks documents across sale, quote, and booking tabs", async () => {
    const [fixture] = await db!.select({ storeId: orders.storeId }).from(orders).limit(1);
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const [sales, quotes, bookings] = await Promise.all([
      getOrders!(fixture.storeId, { documentType: "sale", status: "all", includeCancelled: true, pageSize: 100 }),
      getOrders!(fixture.storeId, { documentType: "quote", status: "all", pageSize: 100 }),
      getOrders!(fixture.storeId, { documentType: "booking", status: "all", pageSize: 100 }),
    ]);
    expect(sales.rows.every((row) => row.documentType === "sale")).toBe(true);
    expect(quotes.rows.every((row) => row.documentType === "quote")).toBe(true);
    expect(bookings.rows.every((row) => row.documentType === "booking")).toBe(true);
  });

  test("keeps active quote and booking lifecycle filters exact", async () => {
    const [fixture] = await db!.select({ storeId: orders.storeId }).from(orders).limit(1);
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const [quotes, bookings] = await Promise.all([
      getOrders!(fixture.storeId, { documentType: "quote", status: "quote", pageSize: 100 }),
      getOrders!(fixture.storeId, { documentType: "booking", status: "confirmed", pageSize: 100 }),
    ]);
    expect(quotes.rows.every((row) => row.status === "quote")).toBe(true);
    expect(bookings.rows.every((row) => row.status === "confirmed")).toBe(true);
  });
});
