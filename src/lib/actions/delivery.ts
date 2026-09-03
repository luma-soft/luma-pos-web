"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, trips, tripStops } from "@/db/schema";
import { type ActionResult, getProfileId, generateCode } from "./common";
import { Routes } from "@/lib/routes";
import { requireStoreContext } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

const createTripSchema = z.object({
  vehicle: z.string().min(1, { error: "validation.required" }),
  driver: z.string().min(1, { error: "validation.required" }),
  note: z.string().optional(),
  orderIds: z.array(z.uuid()).min(1, { error: "delivery.errors.needOrders" }).max(20),
});
export type CreateTripInput = z.input<typeof createTripSchema>;

export async function createTrip(input: CreateTripInput): Promise<ActionResult<{ id: string }>> {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = createTripSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(context.userId);
    const result = await db.transaction(async (tx) => {
      const ownedOrders = await tx.select({ id: orders.id, code: orders.code }).from(orders).where(and(
        eq(orders.storeId, context.storeId),
        inArray(orders.id, v.orderIds),
      ));
      if (ownedOrders.length !== new Set(v.orderIds).size) throw new Error("ORDER_NOT_FOUND");
      const [trip] = await tx.insert(trips).values({
        storeId: context.storeId,
        code: generateCode("CX"),
        vehicle: v.vehicle,
        driver: v.driver,
        status: "planned",
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: trips.id, code: trips.code });

      await tx.insert(tripStops).values(
        v.orderIds.map((orderId, i) => ({ storeId: context.storeId, tripId: trip.id, orderId, sortOrder: i }))
      );
      await recordActivity(tx, {
        storeId: context.storeId, actorId: profileId, action: "delivery.trip.created", entityType: "trip", entityId: trip.id,
        after: { code: trip.code, vehicle: v.vehicle, driver: v.driver, status: "planned", orderCount: ownedOrders.length },
        affectedRecords: ownedOrders.map((order) => ({ type: "order", id: order.id, code: order.code })),
      });
      return trip;
    });
    revalidatePath(Routes.Delivery);
    return { ok: true, data: result };
  } catch (e) {
    console.error("createTrip failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function startTrip(tripId: string): Promise<ActionResult> {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select({ code: trips.code, status: trips.status }).from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.storeId, context.storeId))).limit(1).for("update");
      if (!current) return false;
      if (current.status !== "planned") return true;
      await tx.update(trips).set({ status: "ongoing", departAt: sql`now()` }).where(and(eq(trips.id, tripId), eq(trips.storeId, context.storeId)));
      await recordActivity(tx, {
        storeId: context.storeId, actorId: context.userId, action: "delivery.trip.started", entityType: "trip", entityId: tripId,
        before: current, after: { code: current.code, status: "ongoing" },
      });
      return true;
    });
    if (!updated) return { ok: false, error: "errors.notFound" };
    revalidatePath(Routes.Delivery);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("startTrip failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function markStopDelivered(stopId: string): Promise<ActionResult> {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tripStops)
        .where(and(eq(tripStops.id, stopId), eq(tripStops.storeId, context.storeId))).limit(1).for("update");
      if (!current) throw new Error("STOP_NOT_FOUND");
      if (current.status === "delivered") return;
      const [trip] = await tx.select({ id: trips.id, code: trips.code, status: trips.status }).from(trips)
        .where(and(eq(trips.id, current.tripId), eq(trips.storeId, context.storeId))).limit(1).for("update");
      const [order] = await tx.select({ id: orders.id, code: orders.code }).from(orders)
        .where(and(eq(orders.id, current.orderId), eq(orders.storeId, context.storeId))).limit(1);
      const [stop] = await tx.update(tripStops)
        .set({ status: "delivered", deliveredAt: sql`now()` })
        .where(and(eq(tripStops.id, stopId), eq(tripStops.storeId, context.storeId)))
        .returning({ tripId: tripStops.tripId });
      if (!stop) throw new Error("STOP_NOT_FOUND");

      // tất cả điểm xong → chuyến done
      const [pending] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(tripStops)
        .where(and(eq(tripStops.storeId, context.storeId), sql`${tripStops.tripId} = ${stop.tripId} and ${tripStops.status} != 'delivered'`));
      if (pending.c === 0) {
        await tx.update(trips).set({ status: "done" }).where(and(eq(trips.id, stop.tripId), eq(trips.storeId, context.storeId)));
      } else {
        await tx.update(trips).set({ status: "ongoing" }).where(and(eq(trips.id, stop.tripId), eq(trips.storeId, context.storeId)));
      }
      await recordActivity(tx, {
        storeId: context.storeId, actorId: context.userId, action: "delivery.stop.delivered", entityType: "trip", entityId: stop.tripId,
        before: { status: current.status }, after: { code: trip?.code, orderCode: order?.code, status: "delivered" },
        affectedRecords: order ? [{ type: "order", id: order.id, code: order.code }] : [],
      });
      if (pending.c === 0 && trip?.status !== "done") {
        await recordActivity(tx, {
          storeId: context.storeId, actorId: context.userId, action: "delivery.trip.completed", entityType: "trip", entityId: stop.tripId,
          before: { code: trip?.code, status: trip?.status }, after: { code: trip?.code, status: "done" },
        });
      }
    });
    revalidatePath(Routes.Delivery);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("markStopDelivered failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
