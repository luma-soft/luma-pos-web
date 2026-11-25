import { getReportCustomers, getReportInvoices, getReportProducts, getReports } from "@/lib/data/reports";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";
import { addDaysToKey, isDateKey, isReportPeriod, resolveReportRange, type ReportPeriod } from "@/lib/reports/period";

function reportRange(request: Request) {
  const range = searchParam(request, "range", "today");
  const url = new URL(request.url);
  // The native app's "week" is a rolling 7 days; "month" is this month.
  const period: ReportPeriod = range === "week" ? "7d" : range === "month" ? "this_month" : isReportPeriod(range) ? range : "this_month";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  let resolved = resolveReportRange(period, from, to);
  if (period === "custom" && !(isDateKey(from) && isDateKey(to) && from <= to)) {
    // Older clients send only a day count for custom ranges.
    const today = resolveReportRange("today").fromValue;
    resolved = resolveReportRange("custom", addDaysToKey(today, -(Math.max(1, numberParam(request, "days", 30)) - 1)), today);
  }
  return {
    rangeDays: resolved.rangeDays,
    filters: { from: resolved.from, to: resolved.toExclusive },
  };
}

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const range = reportRange(request);
  const tab = searchParam(request, "tab", "overview");
  const [report, details] = await Promise.all([
    getReports(gate.storeId, range.rangeDays, range.filters),
    tab === "orders"
      ? getReportInvoices(gate.storeId, range.rangeDays, range.filters, 1, 20)
      : tab === "products"
        ? getReportProducts(gate.storeId, range.rangeDays, range.filters, 1, 20)
        : tab === "customers"
          ? getReportCustomers(gate.storeId, range.rangeDays, range.filters, 1, 20)
          : Promise.resolve(null),
  ]);
  return mobileOk({ ...report, details: details?.rows ?? [] });
}
