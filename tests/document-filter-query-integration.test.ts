import { describe, expect, test } from "bun:test";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { orderItems, orders } from "../src/db/schema";
import { getOrders } from "../src/lib/data/orders";

describe("document filter database integration", () => {
  test("combines search, exact customer, exact product and document scope", async () => {
    const [fixture] = await db
      .select({
        id: orders.id,
        code: orders.code,
        customerId: orders.customerId,
        productId: orderItems.productId,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(
        eq(orders.documentType, "sale"),
        isNotNull(orders.customerId),
        isNotNull(orderItems.productId),
      ))
      .limit(1);

    expect(fixture).toBeDefined();
    if (!fixture?.customerId || !fixture.productId) return;
    const result = await getOrders({
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
      getOrders({ ...filters, page: 1, pageSize: 1 }),
      getOrders({ ...filters, page: 1, pageSize: 30 }),
    ]);
    expect(preview.total).toBe(list.total);
    expect(preview.pageCount).toBe(Math.max(1, Math.ceil(preview.total / 1)));
    expect(list.pageCount).toBe(Math.max(1, Math.ceil(list.total / 30)));
  });

  test("never leaks cancelled documents across sale, quote, and booking tabs", async () => {
    const [sales, quotes, bookings] = await Promise.all([
      getOrders({ documentType: "sale", status: "all", includeCancelled: true, pageSize: 100 }),
      getOrders({ documentType: "quote", status: "all", pageSize: 100 }),
      getOrders({ documentType: "booking", status: "all", pageSize: 100 }),
    ]);
    expect(sales.rows.every((row) => row.documentType === "sale")).toBe(true);
    expect(quotes.rows.every((row) => row.documentType === "quote")).toBe(true);
    expect(bookings.rows.every((row) => row.documentType === "booking")).toBe(true);
    expect(quotes.rows.filter((row) => row.status === "cancelled").every((row) => row.documentType === "quote")).toBe(true);
    expect(bookings.rows.filter((row) => row.status === "cancelled").every((row) => row.documentType === "booking")).toBe(true);
  });

  test("keeps active quote and booking lifecycle filters exact", async () => {
    const [quotes, bookings] = await Promise.all([
      getOrders({ documentType: "quote", status: "quote", pageSize: 100 }),
      getOrders({ documentType: "booking", status: "confirmed", pageSize: 100 }),
    ]);
    expect(quotes.rows.every((row) => row.status === "quote")).toBe(true);
    expect(bookings.rows.every((row) => row.status === "confirmed")).toBe(true);
  });
});
