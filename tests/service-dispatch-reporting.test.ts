import { describe, expect, test } from "bun:test";
import {
  parseServiceDispatchQuery,
  parseServiceReportQuery,
  summarizeServiceMetrics,
} from "../src/lib/services/dispatch-reporting-domain";

describe("service dispatch query", () => {
  test("supports composable filters and bounded pagination", () => {
    const query = parseServiceDispatchQuery(new URLSearchParams({
      from: "2026-07-28T17:00:00.000Z",
      to: "2026-08-04T17:00:00.000Z",
      status: "scheduled,in_progress",
      priority: "high,urgent",
      technicianId: "11111111-1111-4111-8111-111111111111",
      unassigned: "false",
      slaOverdue: "true",
      maintenanceOverdue: "true",
      page: "2",
      limit: "25",
    }));
    expect(query.statuses).toEqual(["scheduled", "in_progress"]);
    expect(query.priorities).toEqual(["high", "urgent"]);
    expect(query.page).toBe(2);
    expect(query.limit).toBe(25);
    expect(query.slaOverdue).toBe(true);
    expect(query.maintenanceOverdue).toBe(true);
  });

  test("rejects inverted, oversized, and abusive ranges/pages", () => {
    expect(() => parseServiceDispatchQuery(new URLSearchParams({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-03-01T00:00:00.000Z",
    }))).toThrow("SERVICE_DISPATCH_RANGE_TOO_LARGE");
    expect(() => parseServiceDispatchQuery(new URLSearchParams({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    }))).toThrow("SERVICE_DISPATCH_RANGE_INVALID");
    expect(() => parseServiceDispatchQuery(new URLSearchParams({ page: "10001" })))
      .toThrow("SERVICE_DISPATCH_PAGINATION_INVALID");
    expect(() => parseServiceDispatchQuery(new URLSearchParams({
      technicianId: "11111111---------------------------",
    }))).toThrow("SERVICE_DISPATCH_FILTER_INVALID");
  });

  test("uses half-open timezone-safe instant boundaries", () => {
    const query = parseServiceDispatchQuery(new URLSearchParams({
      from: "2026-07-28T17:00:00.000Z",
      to: "2026-07-29T17:00:00.000Z",
    }));
    expect(query.from.toISOString()).toBe("2026-07-28T17:00:00.000Z");
    expect(query.to.toISOString()).toBe("2026-07-29T17:00:00.000Z");
    const localDates = parseServiceDispatchQuery(new URLSearchParams({
      from: "2026-07-29",
      to: "2026-07-30",
    }));
    expect(localDates.from.toISOString()).toBe("2026-07-28T17:00:00.000Z");
    expect(localDates.to.toISOString()).toBe("2026-07-29T17:00:00.000Z");
  });
});

describe("service manager metrics", () => {
  test("defines first-time completion only for completed jobs with visits", () => {
    expect(summarizeServiceMetrics({
      total: 10,
      completed: 4,
      overdueSla: 2,
      overdueMaintenance: 1,
      workSeconds: 5400,
      visits: 6,
      completedWithVisits: 3,
      completedWithOneVisit: 2,
    })).toEqual({
      total: 10,
      completed: 4,
      completionRate: 40,
      overdueSla: 2,
      overdueMaintenance: 1,
      workMinutes: 90,
      visits: 6,
      firstTimeCompletion: {
        available: true,
        numerator: 2,
        denominator: 3,
        rate: 66.7,
        definition: "completed jobs with exactly one completed visit / completed jobs with at least one completed visit",
      },
    });
  });

  test("labels first-time completion unavailable instead of fabricating it", () => {
    const report = parseServiceReportQuery(new URLSearchParams({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      page: "1",
      limit: "20",
    }));
    expect(report.limit).toBe(20);
    expect(summarizeServiceMetrics({
      total: 0,
      completed: 0,
      overdueSla: 0,
      overdueMaintenance: 0,
      workSeconds: 0,
      visits: 0,
      completedWithVisits: 0,
      completedWithOneVisit: 0,
    }).firstTimeCompletion).toEqual({
      available: false,
      numerator: 0,
      denominator: 0,
      rate: null,
      definition: "completed jobs with exactly one completed visit / completed jobs with at least one completed visit",
    });
  });
});
