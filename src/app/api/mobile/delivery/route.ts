import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createTrip } from "@/lib/actions/delivery";
import { db } from "@/db";
import { customers, orders, trips, tripStops } from "@/db/schema";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  const [tripRows, eligibleOrders] = await Promise.all([
    db
      .select({
        id: trips.id,
        code: trips.code,
        vehicle: trips.vehicle,
        driver: trips.driver,
        status: trips.status,
        departAt: trips.departAt,
        note: trips.note,
        createdAt: trips.createdAt,
      })
      .from(trips)
      .where(eq(trips.storeId, gate.storeId))
      .orderBy(desc(trips.createdAt))
      .limit(20),
    db
      .select({
        id: orders.id,
        code: orders.code,
        customerName: sql<string>`coalesce(${customers.name}, 'Khách lẻ')`,
        deliveryAddress: orders.deliveryAddress,
        total: orders.total,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          eq(orders.storeId, gate.storeId),
          inArray(orders.status, ["completed"]),
          sql`${orders.deliveryAddress} is not null and ${orders.deliveryAddress} <> ''`,
          sql`not exists (select 1 from trip_stops ts where ts.store_id = ${gate.storeId} and ts.order_id = ${orders.id})`,
        ),
      )
      .orderBy(asc(orders.deliveryDate), desc(orders.createdAt))
      .limit(30),
  ]);

  const stops =
    tripRows.length === 0
      ? []
      : await db
          .select({
            id: tripStops.id,
            tripId: tripStops.tripId,
            orderId: tripStops.orderId,
            status: tripStops.status,
            deliveredAt: tripStops.deliveredAt,
            sortOrder: tripStops.sortOrder,
            orderCode: orders.code,
            customerName: sql<string>`coalesce(${customers.name}, 'Khách lẻ')`,
            deliveryAddress: orders.deliveryAddress,
            total: orders.total,
          })
          .from(tripStops)
          .innerJoin(orders, eq(tripStops.orderId, orders.id))
          .leftJoin(customers, eq(orders.customerId, customers.id))
          .where(and(
            eq(tripStops.storeId, gate.storeId),
            inArray(
              tripStops.tripId,
              tripRows.map((trip) => trip.id),
            ),
          ))
          .orderBy(asc(tripStops.sortOrder));

  const stopsByTrip = stops.reduce<Record<string, typeof stops>>(
    (acc, stop) => {
      (acc[stop.tripId] ??= []).push(stop);
      return acc;
    },
    {},
  );

  return mobileOk({
    trips: tripRows.map((trip) => ({
      ...trip,
      stops: stopsByTrip[trip.id] ?? [],
    })),
    eligibleOrders,
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await createTrip(body as Parameters<typeof createTrip>[0]),
  );
}
