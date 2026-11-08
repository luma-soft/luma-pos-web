export type DashboardRange = "today" | "7d" | "30d" | "month" | "week" | "year";

const DASHBOARD_RANGES: readonly DashboardRange[] = ["today", "7d", "30d", "month", "week", "year"];

export function resolveDashboardRange(value: string | undefined): DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange)
    ? value as DashboardRange
    : "today";
}
