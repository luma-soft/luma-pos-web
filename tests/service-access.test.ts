import { describe, expect, test } from "bun:test";
import {
  canAccessServiceJob,
  canManageServiceDispatch,
  fieldJobDateRange,
} from "../src/lib/services/access";

const technicianId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

describe("service job access", () => {
  test("owner and manager can access every service job", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(canAccessServiceJob({
        role,
        profileId: otherId,
        primaryAssigneeId: technicianId,
        crewProfileIds: [],
      })).toBe(true);
    }
  });

  test("technician can access a job as primary assignee or crew member", () => {
    expect(canAccessServiceJob({
      role: "technician",
      profileId: technicianId,
      primaryAssigneeId: technicianId,
      crewProfileIds: [],
    })).toBe(true);
    expect(canAccessServiceJob({
      role: "technician",
      profileId: technicianId,
      primaryAssigneeId: otherId,
      crewProfileIds: [technicianId],
    })).toBe(true);
  });

  test("technician cannot access an unassigned job", () => {
    expect(canAccessServiceJob({
      role: "technician",
      profileId: technicianId,
      primaryAssigneeId: otherId,
      crewProfileIds: [],
    })).toBe(false);
  });

  test("cashier and warehouse cannot access field service jobs", () => {
    for (const role of ["cashier", "warehouse"] as const) {
      expect(canAccessServiceJob({
        role,
        profileId: technicianId,
        primaryAssigneeId: technicianId,
        crewProfileIds: [technicianId],
      })).toBe(false);
    }
  });

  test("only owner and manager can manage dispatch", () => {
    expect(canManageServiceDispatch("owner")).toBe(true);
    expect(canManageServiceDispatch("manager")).toBe(true);
    expect(canManageServiceDispatch("technician")).toBe(false);
  });

  test("builds Today and Week ranges from the store UTC offset", () => {
    const now = new Date("2026-07-29T03:00:00.000Z");
    expect(fieldJobDateRange("today", now, 420)).toEqual({
      from: new Date("2026-07-28T17:00:00.000Z"),
      to: new Date("2026-07-29T17:00:00.000Z"),
    });
    expect(fieldJobDateRange("week", now, 420)).toEqual({
      from: new Date("2026-07-28T17:00:00.000Z"),
      to: new Date("2026-08-04T17:00:00.000Z"),
    });
  });
});
