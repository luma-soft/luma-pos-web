import { fieldJobDateRange } from "@/lib/services/access";

const JOB_STATUSES = [
  "new", "scheduled", "in_progress", "waiting_materials",
  "waiting_customer", "completed", "warranty", "cancelled",
] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const DAY_MS = 86_400_000;
const DEFAULT_OFFSET_MINUTES = 420;
const FIRST_TIME_DEFINITION =
  "completed jobs with exactly one completed visit / completed jobs with at least one completed visit";

function integerParam(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function booleanParam(value: string | null) {
  return value === "true" ? true : value === "false" ? false : undefined;
}

function enumList<T extends string>(value: string | null, allowed: readonly T[]) {
  if (!value) return [] as T[];
  const items = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (items.some((item) => !allowed.includes(item as T))) {
    throw new Error("SERVICE_DISPATCH_FILTER_INVALID");
  }
  return items as T[];
}

function explicitRange(
  params: URLSearchParams,
  maxDays: number,
  fallbackScope: "today" | "week",
  now: Date,
) {
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  if (!rawFrom && !rawTo) return fieldJobDateRange(fallbackScope, now, DEFAULT_OFFSET_MINUTES);
  if (!rawFrom || !rawTo) throw new Error("SERVICE_DISPATCH_RANGE_INVALID");
  const asInstant = (value: string) => new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : value,
  );
  const from = asInstant(rawFrom);
  const to = asInstant(rawTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new Error("SERVICE_DISPATCH_RANGE_INVALID");
  }
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    throw new Error("SERVICE_DISPATCH_RANGE_TOO_LARGE");
  }
  return { from, to };
}

function pagination(params: URLSearchParams) {
  const page = integerParam(params.get("page"), 1);
  const limit = integerParam(params.get("limit"), 50);
  if (page < 1 || page > 10_000 || limit < 1 || limit > 100) {
    throw new Error("SERVICE_DISPATCH_PAGINATION_INVALID");
  }
  return { page, limit };
}

export function parseServiceDispatchQuery(params: URLSearchParams, now = new Date()) {
  const scope = params.get("scope") === "today" ? "today" : "week";
  const range = explicitRange(params, 31, scope, now);
  const technicianId = params.get("technicianId") || undefined;
  if (
    technicianId
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(technicianId)
  ) {
    throw new Error("SERVICE_DISPATCH_FILTER_INVALID");
  }
  return {
    ...range,
    ...pagination(params),
    scope,
    statuses: enumList(params.get("status"), JOB_STATUSES),
    priorities: enumList(params.get("priority"), PRIORITIES),
    technicianId,
    unassigned: booleanParam(params.get("unassigned")),
    slaOverdue: booleanParam(params.get("slaOverdue")),
    maintenanceOverdue: booleanParam(params.get("maintenanceOverdue")),
  };
}

export function parseServiceReportQuery(params: URLSearchParams, now = new Date()) {
  return { ...explicitRange(params, 93, "week", now), ...pagination(params) };
}

export type ServiceMetricInputs = {
  total: number;
  completed: number;
  overdueSla: number;
  overdueMaintenance: number;
  workSeconds: number;
  visits: number;
  completedWithVisits: number;
  completedWithOneVisit: number;
};

export function summarizeServiceMetrics(input: ServiceMetricInputs) {
  const denominator = input.completedWithVisits;
  return {
    total: input.total,
    completed: input.completed,
    completionRate: input.total ? Math.round(input.completed / input.total * 1_000) / 10 : 0,
    overdueSla: input.overdueSla,
    overdueMaintenance: input.overdueMaintenance,
    workMinutes: Math.round(input.workSeconds / 60),
    visits: input.visits,
    firstTimeCompletion: {
      available: denominator > 0,
      numerator: input.completedWithOneVisit,
      denominator,
      rate: denominator
        ? Math.round(input.completedWithOneVisit / denominator * 1_000) / 10
        : null,
      definition: FIRST_TIME_DEFINITION,
    },
  };
}
