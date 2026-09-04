import { describe, expect, mock, test } from "bun:test";
import { orders, serviceJobs, trips } from "@/db/schema";

// Keep the real query projections and response wrappers; replace only database IO.
mock.module("@/db", () => ({
  db: {
    select(selection) {
      let fixture = {};
      if (selection.id === trips.id) fixture = { id: "trip-1", code: "GH-001" };
      else if (selection.tripId) fixture = { id: "stop-1", tripId: "trip-1", orderId: "order-1", customerId: "customer-1", customerName: "Anh Nhật" };
      else if (selection.id === orders.id) fixture = { id: "order-1", code: "DH-001", customerId: "customer-1", customerName: "Anh Nhật" };
      else if (selection.id === serviceJobs.id) fixture = { id: "job-1", projectId: "project-1", primaryAssigneeId: "owner-1", customerId: "customer-1", customerName: "Anh Nhật" };
      const rows = Object.keys(fixture).length
        ? [Object.fromEntries(Object.keys(selection).map((key) => [key, fixture[key] ?? null]))]
        : [];
      const query = new Proxy({}, {
        get(_target, property) {
          if (property === "then") return (resolve) => resolve(rows);
          return () => query;
        },
      });
      return query;
    },
  },
}));
mock.module("@/lib/actions/delivery", () => ({ createTrip: async () => ({ ok: false }) }));
mock.module("@/lib/mobile/auth", () => ({
  requireMobileSalesAccess: async () => ({ ok: true, storeId: "store-1", userId: "owner-1", role: "owner" }),
}));

const { GET: getDelivery } = await import("./delivery/route.ts");
const { getFieldServiceJobs, getFieldServiceJobDetail } = await import("@/lib/data/service-field");
const actor = { userId: "owner-1", role: "owner" };

describe("mobile partner navigation projections", () => {
  test("delivery eligible orders retain the customer identity", async () => {
    const response = await getDelivery();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.eligibleOrders[0]).toMatchObject({ customerId: "customer-1", customerName: "Anh Nhật" });
  });

  test("delivery trip stops retain the customer identity", async () => {
    const { data } = await (await getDelivery()).json();
    expect(data.trips[0].stops[0]).toMatchObject({ customerId: "customer-1", customerName: "Anh Nhật" });
  });

  test("field service job lists retain the project customer's identity", async () => {
    const jobs = await getFieldServiceJobs({ actor, scope: "today", now: new Date("2026-09-04T00:00:00Z") });
    expect(jobs[0]).toMatchObject({ customerId: "customer-1", customerName: "Anh Nhật" });
  });

  test("field service job details retain the project customer's identity", async () => {
    const job = await getFieldServiceJobDetail(actor, "job-1");
    expect(job).toMatchObject({ customerId: "customer-1", customerName: "Anh Nhật" });
  });
});
